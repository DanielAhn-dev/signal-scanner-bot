/**
 * SNS 공유 유틸리티
 */

import { formatKrw } from './format'

export interface ShareData {
  title: string        // 종목명
  code: string         // 종목 코드
  price: number | null // 가격
  changePct?: number   // 변화율
  summaryLines?: string[]
  url?: string         // 공유 링크 (생략하면 현재 페이지)
}

export interface KakaoFeedShareData {
  title: string
  description?: string
  url?: string
  buttonTitle?: string
  imageUrl?: string
}

function buildShareSummary(data: ShareData): string[] {
  const basePrice = data.price != null
    ? `현재가 ${formatKrw(data.price)}${data.changePct != null ? ` (${data.changePct > 0 ? '+' : ''}${data.changePct.toFixed(2)}%)` : ''}`
    : '현재가 —'

  return [basePrice, ...(data.summaryLines ?? [])]
    .map(line => String(line || '').trim())
    .filter(Boolean)
}

function resolveShareUrl(url?: string): string {
  const raw = url || window.location.href
  try {
    const parsed = new URL(raw, window.location.href)
    const sharePublicOrigin = String(
      import.meta.env.VITE_SHARE_PUBLIC_ORIGIN ||
      import.meta.env.VITE_PUBLIC_WEB_ORIGIN ||
      '',
    ).trim()

    // 로컬 개발 환경에서 공유할 때 외부에서 접근 가능한 공개 도메인으로 치환 가능
    if (sharePublicOrigin && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
      const publicBase = new URL(sharePublicOrigin)
      parsed.protocol = publicBase.protocol
      parsed.host = publicBase.host
    }

    return parsed.toString()
  } catch {
    return raw
  }
}

// Kakao SDK 타입 선언 (런타임 주입)
declare global {
  interface Window {
    Kakao?: {
      isInitialized: () => boolean
      init: (key: string) => void
      Share: {
        sendDefault: (settings: Record<string, unknown>) => void
      }
    }
  }
}

let kakaoSdkLoading: Promise<void> | null = null

function loadKakaoSdk(): Promise<void> {
  if (window.Kakao) return Promise.resolve()
  if (kakaoSdkLoading) return kakaoSdkLoading

  kakaoSdkLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js'
    script.crossOrigin = 'anonymous'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Kakao SDK 로드 실패'))
    document.head.appendChild(script)
  })
  return kakaoSdkLoading
}

/** 공유 모달 열릴 때 SDK를 미리 로드 — 클릭 시 user gesture 단절 방지 */
export function preloadKakaoSdk(): void {
  loadKakaoSdk().catch(() => {/* 실패해도 무시 — 클릭 시 재시도 */})
}

function initKakao() {
  const key = String(import.meta.env.VITE_KAKAO_JS_KEY || '')
  if (!key) throw new Error('VITE_KAKAO_JS_KEY 환경변수가 설정되지 않았습니다.')
  if (window.Kakao && !window.Kakao.isInitialized()) {
    window.Kakao.init(key)
  }
}

/**
 * 카카오톡 공유 — Kakao JS SDK sendDefault 방식
 * VITE_KAKAO_JS_KEY 환경변수에 JavaScript 키를 설정해야 합니다.
 * SDK가 미리 로드되지 않은 경우 await이 발생해 팝업이 차단될 수 있으므로
 * 공유 모달 열릴 때 preloadKakaoSdk()를 먼저 호출해 주세요.
 */
export async function shareToKakaotalk(data: ShareData): Promise<void> {
  const url = resolveShareUrl(data.url)
  const description = buildShareSummary(data).join(' · ')

  // SDK가 이미 로드되어 있으면 await 없이 즉시 통과 (user gesture 보존)
  await loadKakaoSdk()
  initKakao()

  window.Kakao!.Share.sendDefault({
    objectType: 'feed',
    content: {
      title: `${data.title} (${data.code})`,
      description,
      imageUrl: 'https://signal-scanner-web.vercel.app/icon-192.png',
      link: {
        mobileWebUrl: url,
        webUrl: url,
      },
    },
    buttons: [
      {
        title: '종목 분석 보기',
        link: {
          mobileWebUrl: url,
          webUrl: url,
        },
      },
    ],
  })
}

export async function shareFeedToKakaotalk(data: KakaoFeedShareData): Promise<void> {
  const url = resolveShareUrl(data.url)
  const description = String(data.description || '').trim() || 'Signal Scanner 공유'

  await loadKakaoSdk()
  initKakao()

  window.Kakao!.Share.sendDefault({
    objectType: 'feed',
    content: {
      title: String(data.title || 'Signal Scanner').trim(),
      description,
      imageUrl: String(data.imageUrl || 'https://signal-scanner-web.vercel.app/icon-192.png'),
      link: {
        mobileWebUrl: url,
        webUrl: url,
      },
    },
    buttons: [
      {
        title: String(data.buttonTitle || '바로 보기').trim(),
        link: {
          mobileWebUrl: url,
          webUrl: url,
        },
      },
    ],
  })
}

/**
 * Twitter(X) 공유
 */
export function shareToTwitter(data: ShareData) {
  const message = [`${data.title} (${data.code})`, ...buildShareSummary(data)].join('\n')
  const url = resolveShareUrl(data.url)
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}&url=${encodeURIComponent(url)}`
  window.open(twitterUrl, 'twitter-share', 'width=550,height=420')
}

/**
 * URL 복사
 */
export async function copyToClipboard(data: ShareData) {
  const url = resolveShareUrl(data.url)
  const message = [`${data.title} (${data.code}) - 종목 분석`, ...buildShareSummary(data), '', url].join('\n')
  
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
  const url = resolveShareUrl(data.url)
  const text = [`${data.title} (${data.code})`, ...buildShareSummary(data).slice(0, 3)].join('\n')
  
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

