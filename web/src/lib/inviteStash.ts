/**
 * 초대 링크(?invite=CODE)로 들어온 코드를 로그인 왕복(구글 이동) 동안 보관한다.
 * 가입 화면이 열릴 때 꺼내 쓰고, 가입에 성공하면 지운다.
 */
const KEY = 'invite-code-stash'

export function captureInviteFromUrl(): void {
  try {
    const code = new URLSearchParams(window.location.search).get('invite')
    if (!code) return
    window.localStorage.setItem(KEY, code.trim().slice(0, 32))
    const url = new URL(window.location.href)
    url.searchParams.delete('invite')
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
