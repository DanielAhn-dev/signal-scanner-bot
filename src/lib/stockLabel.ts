/**
 * 알림·메모에 종목을 적을 때 쓰는 표기. 코드만 보내면 무슨 종목인지 알 수 없어서 "이름(코드)"로 쓴다.
 * 이름이 없거나 코드와 같으면(이름이 코드로 저장된 행) 코드만 쓴다.
 */
export function formatStockLabel(code: string, name?: string | null): string {
  const c = String(code ?? "").trim();
  const n = String(name ?? "").trim();
  if (!n || n === c) return c;
  if (!c) return n;
  return `${n}(${c})`;
}

/** 이름 맵으로 표기를 만든다 — Map·객체 둘 다 받는다 */
export function labelFromNameMap(
  code: string,
  names: Map<string, string> | Record<string, string | null | undefined> | null | undefined
): string {
  if (!names) return formatStockLabel(code);
  const name = names instanceof Map ? names.get(code) : names[code];
  return formatStockLabel(code, name);
}
