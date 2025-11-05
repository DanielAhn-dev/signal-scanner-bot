import type { VercelRequest, VercelResponse } from "@vercel/node";
import { KRXClient } from "../packages/data/krx-client";
import { searchByNameOrCode, getNamesForCodes } from "../packages/data/search";
import { getTopSectors, getLeadersForSector } from "../packages/data/sector";

const SECRET = process.env.TELEGRAM_BOT_SECRET!;
const TOKEN  = process.env.TELEGRAM_BOT_TOKEN!;
const ADMIN  = process.env.TELEGRAM_ADMIN_CHAT_ID;

export const config = { api: { bodyParser: false } };

type Update = { message?: { text?: string; chat: { id: number|string }; from: { id: number|string } } };
type OHLCV = { date:string; code:string; open:number; high:number; low:number; close:number; volume:number; amount:number };

async function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""; req.on("data",(c)=>data+=c); req.on("end",()=>resolve(data)); req.on("error",reject);
  });
}

function sma(a:number[], n:number){ const o:number[]=[]; let s=0; for(let i=0;i<a.length;i++){ s+=a[i]; if(i>=n) s-=a[i-n]; o.push(i>=n-1? s/n : NaN);} return o; }
function rsiWilder(c:number[], n=14){ const r:number[]=[]; let g=0,l=0; for(let i=1;i.length;i++){ const ch=c[i]-c[i-1]; const gg=Math.max(ch,0), ll=Math.max(-ch,0);
  if(i<=n){ g+=gg; l+=ll; r.push(NaN); continue; } if(i===n+1){ let ag=g/n, al=l/n; const rs=al===0?100:ag/al; r.push(100-100/(1+rs)); g=ag;l=al; continue; }
  g=(g*(n-1)+gg)/n; l=(l*(n-1)+ll)/n; const rs=l===0?100:g/l; r.push(100-100/(1+rs)); } r.unshift(...Array(Math.max(0,c.length-r.length)).fill(NaN)); return r; }
function roc(c:number[], n:number){ returnrn c.map((v,i)=> i>=n? ((v-c[i-n])/c[i-n])*100 : NaN); }

function scoreFromIndicators(closes:number[], vols:number[]){
  const s20=sma(closes,20), s50=sma(closes,50), s200=sma(closes,200), r14=rsiWilder(closes,14);
  const c=closes.at(-1)!, s20l=s20.at(-1)!, s50l=s50.at(-1)!, s200l=s200.at(-1)!, s200Prev=s200.at(-2)!;
  const s200Slope = (!isNaN(s200l)&&!isNaN(s200Prev))? s200l-s200Prev : 0;
  const roc14=roc(closes,14), roc21=roc(closes,21), r14Last=r14.at(-1)!, roc14Last=roc14.at(-1)!, roc21Last=roc21.at(-1)!;
  let score=0;
  if(!isNaN(s20l)&&c>s20l) score+=3; if(!isNaN(s50l)&&c>s50l) score+=4; if(!isNaN(s200l)&&c>s200l) score+=5;
  if(s200Slope>0) score+=4; if(!isNaN(r14Last)) score+= r14Last>50?2: r14Last<40?-2:0;
  if(!isNaN(roc14Last)) score+= roc14Last>0?2:-2; if(!isNaN(roc21Last)) score+= Math.abs(roc21Last)<2?1:0;
  let signal:"buy"|"hold"|"sell"|"none"="none"; if(score>=12) signal="buy"; else if(score<=2) signal="sell"; else signal="hold";
  const recommendation = signal==="buy" ? "엔트리는 20SMA 근처 눌림 재돌파, 손절 −7~−8%, 익절 +20~25% 분할 제안"
    : signal==="sell" ? "50일선·AVWAP 하회 시 청산 고려" : "보유, 50일선 하회 시 트레일링 스탑 검토";
  return { score, signal, recommendation, factors:{
    sma20:isNaN(s20l)?0:(c>s20l?3:-3), sma50:isNaN(s50l)?0:(c>s50l?4:-4), sma200:isNaN(s200l)?0:(c>s200l?5:-5),
    sma200_slope:s200Slope, rsi14:isNaN(r14Last)?0:Math.round(r14Last),
    roc14:isNaN(roc14Last)?0:Math.round(roc14Last), roc21:isNaN(roc21Last)?0:Math.round(roc21Last), avwap_support:0
  }};
}

function withTimeout<T>(p:Promise<T>, ms:number, label="op"){ return Promise.race([p,new Promise<T>((_,rej)=>setTimeout(()=>rej(new Error(`timeout:${label}`)),ms))]) as Promise<T>; }

export default async function handler(req: VercelRequest, res: VercelResponse){
  if(req.method!=="POST") return res.status(405).send("Method Not Allowed");
  const secretHeader = req.headers["x-telegram-bot-api-secret-token"] as string;
  if(!secretHeader || secretHeader!==SECRET) return res.status(401).send("Unauthorized");

  let update:Update|null=null; try{ const raw=await readRawBody(req); update=JSON.parse(raw); }catch{ return res.status(200).send("OK"); }
  const message = update?.message; if(!message) return res.status(200).send("OK");
  const text = message.text || "";

  // 1) 콜백 최우선
  const callback = (update as any).callback_query as { id:string; data?:string; message:{chat:{id:number|string}} }|undefined;
  const baseChatId = callback? callback.message.chat.id : message.chat.id;
  const reply = async (t:string, extra?:any, chatOverride?:number|string)=>{
    const cid = chatOverride ?? baseChatId;
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ chat_id: cid, text: t, parse_mode:"Markdown", reply_markup: extra?.reply_markup })
    }).catch(()=>{});
  };

  if(callback){
    const cb = callback.data || ""; await answerCallbackQuery(callback.id);
    if(cb.startsWith("sector:")){
      const sector = cb.slice("sector:".length);
      const codes  = await getLeadersForSector(sector);
      const nameMap= await getNamesForCodes(codes);
      const rows   = codes.slice(0,10).map(code=>[{ text:`${nameMap[code]||code} (${code})`, data:`score:${code}`}]);
      await reply(`📈 ${sector} 대장주 후보를 선택하세요:`, { reply_markup: toInlineKeyboard(rows) });
    } else if(cb.startsWith("score:")){
      const code = cb.slice("score:".length);
      try{ await analyzeAndReply(code, reply); }catch(e:any){ await reply(`❌ 분석 실패: ${String(e?.message||e)}`); }
    } else if(cb.startsWith("stocks:")){
      const sector = cb.slice("stocks:".length);
      await handleStocksBySector(sector, reply);
    }
    return res.status(200).send("OK");
  }

  // 2) 텍스트 명령
  const txt = text.trim();
  const isScore = /^\/?점수\b/.test(txt) || txt.endsWith(" 점수") || txt.startsWith("/score");
  if(isScore){
    const arg = txt.replace(/^\/?점수\b|\s*점수$/g,"").trim().replace(/^\/score\s*/,"");
    const q = arg || txt.split(/\s+/)[1] || "";
    if(!q){ await reply("⚠️ 사용법: /점수 삼성전자  또는  /score 005930"); return res.status(200).send("OK"); }
    await reply("🔍 분석 중...");
    try{ await handleScoreFlow(q, reply); }catch(e:any){ await reply(`❌ 데이터 수집 실패: ${String(e?.message||e).slice(0,120)}`); }
    return res.status(200).send("OK");
  }

  const isSector = /^\/?섹터\b/.test(txt);
  const isStocks = /^\/?종목\b/.test(txt);
  if(isSector){
    const tops = await getTopSectors(6);
    if(!tops.length){ await reply("⚠️ 섹터 데이터가 부족합니다. stocks.sector를 채워주세요."); return res.status(200).send("OK"); }
    const rows = tops.map(s=>[{ text:`${s.sector} (점수 ${Math.round(s.score)})`, data:`sector:${s.sector}`}]);
    await reply("📊 유망 섹터를 선택하세요:", { reply_markup: toInlineKeyboard(rows) });
    return res.status(200).send("OK");
  }
  if(isStocks){
    const sector = txt.split(/\s+/)[1] || "반도체";
    await handleStocksBySector(sector, reply);
    return res.status(200).send("OK");
  }

  // 도움말
  if(txt.startsWith("/start") || txt.startsWith("/시작")){
    await reply(
      "📱 명령어:\n"+
      "/시작 - 시작\n"+
      "/섹터 - 유망 섹터\n"+
      "/종목 <섹터> - 대장주 후보\n"+
      "/점수 <이름|코드> - 점수/신호\n"+
      "/매수 <코드> - 엔트리 제안"
    );
    return res.status(200).send("OK");
  }

  // 기타
  await reply("❓ 알 수 없는 명령입니다. /시작 으로 도움말을 확인하세요.");
  return res.status(200).send("OK");

  // 내부 유틸
  async function handleScoreFlow(input:string, reply:(t:string,extra?:any)=>Promise<void>){
    if(/^\d{6}$/.test(input)){ await analyzeAndReply(input, reply); return; }
    const candidates = await searchByNameOrCode(input, 8);
    if(candidates.length===0){ await reply(`❌ 종목을 찾지 못했습니다: ${input}\n다시 입력해 주세요.`); return; }
    if(candidates.length>1){
      const rows = candidates.map(c=>[{ text:`${c.name} (${c.code})`, data:`score:${c.code}`}]);
      await reply("🔎 종목을 선택하세요:", { reply_markup: toInlineKeyboard(rows) });
      return;
    }
    await analyzeAndReply(candidates[0].code, reply);
  }

  async function analyzeAndReply(code:string, reply:(t:string,extra?:any)=>Promise<void>){
    const krx = new KRXClient();
    const end=new Date(), start=new Date(end.getTime()-420*24*60*60*1000);
    const endDate=end.toISOString().slice(0,10), startDate=start.toISOString().slice(0,10);

    let ohlcv:any[]=[];
    try{ ohlcv = await withTimeout(krx.getMarketOHLCV(code,startDate,endDate), 12000, "krx"); }catch{}
    if(ohlcv.length<220){
      try{ const alt = await withTimeout(krx.getMarketOHLCVFromNaver(code,startDate,endDate), 8000, "naver"); if(alt.length>ohlcv.length) ohlcv=alt; }catch{}
    }
    if(ohlcv.length<200){ await reply(`❌ 데이터 부족/지연(필요 200봉): ${code}`); return; }

    const closes = ohlcv.map(d=>d.close), vols = ohlcv.map(d=>d.volume);
    const result = scoreFromIndicators(closes, vols);
    const nameMap = await getNamesForCodes([code]); const title = `${nameMap[code]||code} (${code})`;
    const last = ohlcv.at(-1)!; const emoji = result.signal==="buy"?"🟢": result.signal==="sell"?"🔴":"🟡";
    const msg = `${emoji} ${title} 분석 결과\n\n`+
      `가격: ${last.close.toLocaleString()}원\n`+
      `점수: ${result.score} / 100\n`+
      `신호: ${result.signal.toUpperCase()}\n\n`+
      `세부:\n`+
      `• 20SMA: ${result.factors.sma20}\n`+
      `• 50SMA: ${result.factors.sma50}\n`+
      `• 200SMA: ${result.factors.sma200}\n`+
      `• RSI14: ${result.factors.rsi14}\n`+
      `• ROC14: ${result.factors.roc14}\n`+
      `• ROC21: ${result.factors.roc21}\n\n`+
      `추천: ${result.recommendation}`;
    await reply(msg);
  }

  async function handleStocksBySector(sector:string, reply:(t:string,extra?:any)=>Promise<void>){
    const codes = await getLeadersForSector(sector);
    const nameMap = await getNamesForCodes(codes);
    const rows = codes.slice(0,10).map(code=>[{ text:`${nameMap[code]||code} (${code})`, data:`score:${code}`}]);
    await reply(`📈 ${sector} 대장주 후보를 선택하세요:`, { reply_markup: toInlineKeyboard(rows) });
  }
}

function toInlineKeyboard(rows:{text:string;data:string}[][]){
  return { inline_keyboard: rows.map(r=> r.map(b=>({ text:b.text, callback_data:b.data }))) };
}

async function answerCallbackQuery(id:string, text?:string){
  await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`,{
    method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ callback_query_id:id, text:text||"" })
  }).catch(()=>{});
}
