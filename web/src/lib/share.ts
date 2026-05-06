/**
 * SNS 공유 유틸리티
 */

export interface ShareData {
  title: string        // 종목명
  code: string         // 종목 코드
  price: number | null // 가격
  changePct?: number   // 변화율
  url?: string         // 공유 링크 (생략하면 현재 페이지)
}

/**
 * 카카오톡 공유 (앱 설치 필요)
 */
export function shareToKakaotalk(data: ShareData) {
  const price = data.price != null ? formatKrw(data.price) : '조회 중'
  const pctStr = data.changePct != null ? `${data.changePct > 0 ? '+' : ''}${data.changePct.toFixed(2)}%` : '—'
  const message = `${data.title} (${data.code})\n가격: ${price} ${pctStr}`
  
  // 카카오톡 앱이 설치되어 있으면 앱으로, 없으면 웹으로
  const url = data.url || window.location.href
  const encodedUrl = encodeURIComponent(url)
  const encodedMsg = encodeURIComponent(message)
  
  // 카카오톡 프로토콜 (앱)
  const kakaoAppUrl = `kakaoagent://silencereminder.send?url=${encodedUrl}&text=${encodedMsg}`
  
  // 웹 버전 폴백
  const kakaoWebUrl = `https://share.kakao.com/web/link?url=${encodedUrl}&text=${encodedMsg}`
  
  try {
    // 먼저 앱 링크 시도 (짧은 타임아웃)
    const timeout = setTimeout(() => {
      window.location.href = kakaoWebUrl
    }, 500)
    window.location.href = kakaoAppUrl
    setTimeout(() => clearTimeout(timeout), 1000)
  } catch {
    window.location.href = kakaoWebUrl
  }
}

/**
 * Twitter(X) 공유
 */
export function shareToTwitter(data: ShareData) {
  const message = `${data.title} (${data.code})\n현재가: ${data.price != null ? formatKrw(data.price) : '—'}\n변화: ${data.changePct != null ? `${data.changePct > 0 ? '+' : ''}${data.changePct.toFixed(2)}%` : '—'}`
  const url = data.url || window.location.href
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}&url=${encodeURIComponent(url)}`
  window.open(twitterUrl, 'twitter-share', 'width=550,height=420')
}

/**
 * URL 복사
 */
export async function copyToClipboard(data: ShareData) {
  const url = data.url || window.location.href
  const message = `${data.title} (${data.code}) - 종목 분석\n가격: ${data.price != null ? formatKrw(data.price) : '—'}\n변화: ${data.changePct != null ? `${data.changePct > 0 ? '+' : ''}${data.changePct.toFixed(2)}%` : '—'}\n\n${url}`
  
  try {
    await navigator.clipboard.writeText(message)
    return true
  } catch {
    return false
  }
}

/**
 * 웹 공유 API (모바일 지원)
 */
export async function shareViaWebAPI(data: ShareData) {
  const url = data.url || window.location.href
  const text = `${data.title} (${data.code}) - 현재가 ${data.price != null ? formatKrw(data.price) : '—'}`
  
  if (navigator.share) {
    try {
      await navigator.share({
        title: data.title,
        text,
        url,
      })
      return true
    } catch (e) {
      if ((e as any)?.name !== 'AbortError') {
        console.error('Web Share API 실패:', e)
      }
      return false
    }
  }
  return false
}

/**
 * KRW 포매팅
 */
function formatKrw(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M원`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K원`
  }
  return `${value.toFixed(0)}원`
}
