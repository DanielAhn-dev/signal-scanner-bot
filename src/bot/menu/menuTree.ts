import type { InlineButton } from "../../telegram/keyboards";
import { ACTIONS } from "../messages/layout";

export type MenuNode = {
  id: string;
  title?: string;
  text?: string;
  buttons: InlineButton[];
};

const MENU_NODES: Record<string, MenuNode> = {
  root: {
    id: "root",
    title: "메뉴",
    text: "원하는 작업을 선택하세요.",
    buttons: [
      { text: "주간 코파일럿", callback_data: "menu:weekly" },
      { text: "브리핑", callback_data: "menu:briefing" },
      { text: "시장 허브", callback_data: "menu:market" },
      { text: "리포트", callback_data: "menu:report" },
      { text: "ETF 허브", callback_data: "menu:etf" },
      { text: "포트폴리오", callback_data: "menu:watch" },
      { text: "설정/프로필", callback_data: "menu:settings" },
      { text: "도움말", callback_data: "cmd:help" },
    ],
  },

  weekly: {
    id: "weekly",
    title: "주간 코파일럿",
    text: "주간 코파일럿 관련 작업들입니다.",
    buttons: [...ACTIONS.weeklyCopilot, { text: "뒤로", callback_data: "menu:root" }],
  },

  briefing: {
    id: "briefing",
    title: "브리핑",
    text: "오늘의 브리핑 관련 기능입니다.",
    buttons: [...ACTIONS.briefingPrimary, ...ACTIONS.briefing, { text: "뒤로", callback_data: "menu:root" }],
  },

  market: {
    id: "market",
    title: "시장 허브",
    text: "시장을 중심으로 한 주요 기능입니다.",
    buttons: [...ACTIONS.marketHub, ...ACTIONS.marketFlow, { text: "뒤로", callback_data: "menu:root" }],
  },

  report: {
    id: "report",
    title: "리포트",
    text: "리포트 관련 항목입니다.",
    buttons: [...ACTIONS.reportMenu, { text: "뒤로", callback_data: "menu:root" }],
  },

  etf: {
    id: "etf",
    title: "ETF 허브",
    text: "ETF 관련 기능입니다.",
    buttons: [...ACTIONS.etfHub, { text: "뒤로", callback_data: "menu:root" }],
  },

  autocycle: {
    id: "autocycle",
    title: "자동사이클",
    text: "자동사이클 관련 빠른 작업입니다.",
    buttons: [...ACTIONS.autoCycleMenu, { text: "뒤로", callback_data: "menu:root" }],
  },

  watch: {
    id: "watch",
    title: "포트폴리오",
    text: "관심·보유·대응 관련 기능입니다.",
    buttons: [
      { text: "관심 목록", callback_data: "cmd:watchlist" },
      { text: "관심추가", callback_data: "cmd:watchadd" },
      { text: "관심제거", callback_data: "cmd:watchremove" },
      { text: "보유 목록", callback_data: "cmd:watchlist" },
      { text: "보유대응", callback_data: "cmd:watchresp" },
      { text: "거래기록", callback_data: "cmd:tradelog" },
      { text: "뒤로", callback_data: "menu:root" },
    ],
  },

  settings: {
    id: "settings",
    title: "설정 및 프로필",
    text: "계정 설정과 온보딩, 투자성향 등을 관리합니다.",
    buttons: [
      { text: "온보딩 가이드", callback_data: "cmd:onboarding" },
      { text: "투자성향", callback_data: "cmd:riskprofile" },
      { text: "투자금 설정", callback_data: "prompt:capital" },
      { text: "프로필", callback_data: "cmd:profile" },
      { text: "뒤로", callback_data: "menu:root" },
    ],
  },
};

export function getMenuNode(path: string): MenuNode | undefined {
  if (!path) return MENU_NODES.root;
  const cleaned = path.replace(/^\/+/, "").trim().toLowerCase();
  if (!cleaned) return MENU_NODES.root;
  // allow paths like "weekly" or "/weekly"
  return MENU_NODES[cleaned];
}

export function listMenuIds(): string[] {
  return Object.keys(MENU_NODES);
}

export default MENU_NODES;
