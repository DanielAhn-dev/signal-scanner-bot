import { useEffect } from 'react'

/**
 * 모바일 키보드가 올라오면 보이는 영역(visualViewport)만큼만 앱 높이를 줄이고 맨 위에 붙인다.
 * 이게 없으면 iOS가 입력창을 보여 주려고 화면 전체를 위로 밀어 타이틀바·리본이 사라지고 상태바와 겹친다.
 * 키보드가 없으면 변수를 지워 평소(100dvh) 레이아웃을 그대로 쓴다. 값은 CSS 변수 --app-vh, --vv-top.
 */
export function useVisualViewportVars() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const update = () => {
      const keyboardOpen = window.innerHeight - vv.height > 120
      if (keyboardOpen) {
        root.style.setProperty('--app-vh', `${vv.height}px`)
        root.style.setProperty('--vv-top', `${vv.offsetTop}px`)
      } else {
        root.style.removeProperty('--app-vh')
        root.style.removeProperty('--vv-top')
        if (window.scrollY !== 0) window.scrollTo(0, 0)
      }
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.removeProperty('--app-vh')
      root.style.removeProperty('--vv-top')
    }
  }, [])
}
