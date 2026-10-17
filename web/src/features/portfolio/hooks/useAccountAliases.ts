import { useCallback, useState } from 'react'
import { useSyncedSettings } from '../../../lib/userState'
import { normalizeAliases, setAlias, type AccountAliases } from '../lib/accountAliases'

/** 계좌 별칭 — 사용자별로 저장되어 기기를 바꿔도 따라온다. 종목 데이터는 바꾸지 않는다 */
export function useAccountAliases() {
  const [aliases, setAliases] = useState<AccountAliases>({})

  useSyncedSettings(
    'accountAliases',
    { aliases },
    { aliases: {} as AccountAliases },
    (saved) => setAliases(normalizeAliases(saved.aliases)),
  )

  const rename = useCallback((key: string, input: string) => {
    setAliases((prev) => setAlias(prev, key, input))
  }, [])

  return { aliases, rename }
}
