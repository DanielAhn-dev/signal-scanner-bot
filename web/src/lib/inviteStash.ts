/**
 * 초대 링크(?invite=CODE)로 들어온 코드를 로그인 왕복(구글 이동) 동안 보관한다.
 * 가입 화면이 열릴 때 꺼내 쓰고, 가입에 성공하면 지운다.
 */
const KEY = 'invite-code-stash'

// 부부 연결 링크(?couple=CODE). 가입 전이면 가입 화면 코드 칸에, 이미 회원이면 부부 연결 화면에서 수락을 묻는다
const COUPLE_KEY = 'couple-code-stash'

export function captureInviteFromUrl(): void {
  try {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('invite')
    const couple = params.get('couple')
    if (!code && !couple) return
    if (code) window.localStorage.setItem(KEY, code.trim().slice(0, 32))
    if (couple) window.localStorage.setItem(COUPLE_KEY, couple.trim().slice(0, 32))
    const url = new URL(window.location.href)
    url.searchParams.delete('invite')
    url.searchParams.delete('couple')
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
  } catch { /* ignore */ }
}

export function readStashedInvite(): string {
  try { return window.localStorage.getItem(KEY) || '' } catch { return '' }
}

export function clearStashedInvite(): void {
  try { window.localStorage.removeItem(KEY) } catch { /* ignore */ }
}

export function buildInviteLink(code: string): string {
  return `${window.location.origin}/?invite=${encodeURIComponent(code)}`
}

export function readStashedCouple(): string {
  try { return window.localStorage.getItem(COUPLE_KEY) || '' } catch { return '' }
}

export function clearStashedCouple(): void {
  try { window.localStorage.removeItem(COUPLE_KEY) } catch { /* ignore */ }
}

export function buildCoupleLink(code: string): string {
  return `${window.location.origin}/?couple=${encodeURIComponent(code)}`
}
