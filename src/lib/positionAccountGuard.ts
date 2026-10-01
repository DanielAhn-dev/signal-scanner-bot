/**
 * 계좌 보유 추가·수정이 다른 계좌의 같은 종목 행을 덮어쓰지 않게 막는다.
 *
 * virtual_positions는 UNIQUE(chat_id, code)라 한 사용자의 같은 종목은 행이 하나뿐이다. 그런데 보유 추가(holdingrestore)와
 * 수정(holdingedit)은 (chat_id, code)로 찾은 행에 증권사·계좌명을 덮어썼다 — 봇이 남는 현금으로 KODEX 200을 들고 있을 때
 * 실계좌에 KODEX 200을 넣으면 봇 가상 계좌의 행이 실계좌 행으로 바뀌어 봇 원장(현금·보유)이 어긋났다.
 * 같은 종목을 계좌별로 따로 두려면 유니크 키를 바꾸는 마이그레이션이 필요하다 — 그 전까지는 저장하지 않고 이유를 알려 준다.
 */
export type PositionAccountRow = {
  broker_name: string | null;
  account_name: string | null;
  quantity: number | null;
  status?: string | null;
};

const label = (v: string | null | undefined) => String(v ?? "").trim();
const isVirtual = (broker: string | null | undefined, account: string | null | undefined) => !label(broker) && !label(account);
const describe = (broker: string | null | undefined, account: string | null | undefined) =>
  isVirtual(broker, account) ? "봇 가상 계좌" : `'${[label(broker), label(account)].filter(Boolean).join(" / ")}' 계좌`;

/** 덮어쓰면 안 되는 경우 사용자에게 보여 줄 이유, 괜찮으면 null */
export function findPositionAccountConflict(input: {
  mode: "holdingrestore" | "holdingedit";
  existing: PositionAccountRow | null;
  brokerName: string | null;
  accountName: string | null;
}): string | null {
  const { existing, brokerName, accountName, mode } = input;
  if (!existing) return null;
  const status = String(existing.status ?? "").toLowerCase();
  // 관심 종목(수량 0) 행은 보유로 바꿔도 잃는 것이 없다
  if (!(Number(existing.quantity ?? 0) > 0) || status === "watch" || status === "interest" || status === "closed") return null;
  const sameAccount = label(existing.broker_name) === label(brokerName) && label(existing.account_name) === label(accountName);
  if (sameAccount) return null;
  const fromVirtual = isVirtual(existing.broker_name, existing.account_name);
  const toVirtual = isVirtual(brokerName, accountName);
  // 수정에서 실계좌끼리 계좌 이름을 바꾸는 것은 허용 (같은 행의 이름표만 바뀐다)
  if (mode === "holdingedit" && !fromVirtual && !toVirtual) return null;
  return `이 종목은 이미 ${describe(existing.broker_name, existing.account_name)}에 ${Number(existing.quantity)}주 있습니다. 지금 구조에서는 같은 종목을 계좌별로 따로 둘 수 없어, 저장하면 ${describe(existing.broker_name, existing.account_name)}의 보유가 덮어써집니다. 저장하지 않았습니다.`;
}
