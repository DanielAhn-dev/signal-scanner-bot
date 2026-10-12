import { useEffect } from 'react'
import { useToast } from '../../../components/ToastProvider'
import useWatchlistActions from '../../../hooks/useWatchlistActions'

export function useScanWatchlist() {
  const toast = useToast()

  const {
    loadWatchlistCodes,
    isWatched,
    isAdding,
    isRemoving,
    addToWatchlist,
    removeFromWatchlist,
  } = useWatchlistActions()

  useEffect(() => {
    loadWatchlistCodes().catch(() => {
      // 관심종목 조회 실패 시에도 스캔 화면은 계속 사용 가능해야 함
    })
  }, [loadWatchlistCodes])

  const onAddToWatchlist = async (code: string) => {
    try {
      const result = await addToWatchlist(code)
      if (result === 'added') {
        toast.show('관심 종목에 추가되었습니다')
      } else if (result === 'exists') {
        toast.show('이미 관심 종목에 있습니다')
      }
    } catch (e: any) {
      toast.show(String(e?.message || e))
    }
  }

  const onToggleWatchlist = async (e: React.MouseEvent, code: string) => {
    e.stopPropagation()
    if (!code) return
    if (isWatched(code)) {
      try {
        const result = await removeFromWatchlist(code)
        if (result === 'removed' || result === 'not-found') {
          toast.show('관심 종목에서 제거되었습니다')
        }
      } catch (e: any) {
        toast.show(String(e?.message || e))
      }
      return
    }
    await onAddToWatchlist(code)
  }

  return {
    isWatched,
    isAdding,
    isRemoving,
    onToggleWatchlist,
  }
}
