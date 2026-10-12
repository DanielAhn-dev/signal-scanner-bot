import { useEffect, useMemo, useRef, useState } from 'react'
import { useSeedCapitalState } from '../../../lib/useSeedCapital'
import { readSimulationPlan } from '../../simulator/planStore'
import { EXECUTION_GUIDE_PENDING_KEY } from '../constants'
import { normalizeSourceLabel, parseCodes } from '../lib/codes'
import type { RiskMode } from '../types'

/** 입력값(종목·투자금·비중·분할·성향·출처)과 마운트 시 이어받기(URL → 세션 → 시뮬레이터 계획) */
export function useGuideInputs() {
  const [codesText, setCodesText] = useState('')
  // 투자금: 시뮬레이터 계획 → 내 시드 순으로 채운다 (예전엔 1천만원 고정). 직접 입력하면 유지.
  const { seed: seedCapital, loaded: seedLoaded } = useSeedCapitalState()
  const [capital, setCapitalRaw] = useState('10000000')
  const capitalEditedRef = useRef(false)
  const setCapital = (v: string) => {
    capitalEditedRef.current = true
    setCapitalRaw(v)
  }
  const [maxWeightPct, setMaxWeightPct] = useState('25')
  const [splitCount, setSplitCount] = useState('4')
  const [riskMode, setRiskMode] = useState<RiskMode>('neutral')
  const [sourceLabel, setSourceLabel] = useState('수동 입력')
  const [includeNews, setIncludeNews] = useState(true)
  const [hydratedByPending, setHydratedByPending] = useState(false)
  // 시뮬레이터 계획에서 투자금을 받았는지. 받았으면 시드 조회를 기다릴 필요가 없다.
  const [capitalFromPlan, setCapitalFromPlan] = useState(false)

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const urlCodes = params.get('codes')
      const urlSource = params.get('source')
      if (urlCodes) {
        const normalized = parseCodes(urlCodes).join(', ')
        if (normalized) setCodesText(normalized)
      }
      if (urlSource) setSourceLabel(normalizeSourceLabel(urlSource))

      const pendingRaw = sessionStorage.getItem(EXECUTION_GUIDE_PENDING_KEY)
      if (pendingRaw) {
        const parsed = JSON.parse(pendingRaw) as { codes?: string[]; source?: string }
        if (Array.isArray(parsed?.codes) && parsed.codes.length > 0) {
          setCodesText(parseCodes(parsed.codes.join(',')).join(', '))
          setHydratedByPending(true)
        }
        if (parsed?.source) setSourceLabel(normalizeSourceLabel(String(parsed.source)))
        sessionStorage.removeItem(EXECUTION_GUIDE_PENDING_KEY)
      } else if (!urlCodes) {
        // 5단계 시뮬레이터에서 "다음"으로 오면 넘겨받은 종목이 없어 빈 화면이었다 — 최근 시뮬레이터 계획을 이어받는다
        const plan = readSimulationPlan()
        const planCodes = (plan?.items ?? []).map((row) => String(row.code || '')).filter((code) => code && code !== 'CASH')
        if (planCodes.length > 0) {
          setCodesText(parseCodes(planCodes.join(',')).join(', '))
          setSourceLabel('시뮬레이터 계획')
          setHydratedByPending(true)
        }
      }
      // 투자금은 어느 경로로 왔든 시뮬레이터 계획 → 내 시드 순. 예전엔 다른 화면이 종목을 넘기면
      // 계획 투자금도 시드도 반영되지 않아 1천만원 기본값으로 수량이 계산됐다.
      const planCapital = readSimulationPlan()?.totalCapital ?? 0
      if (planCapital > 0 && !capitalEditedRef.current) {
        setCapitalRaw(String(planCapital))
        setCapitalFromPlan(true)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    // 시뮬레이터 계획의 투자금이 없을 때만 시드로
    if (seedCapital && !capitalEditedRef.current && !(readSimulationPlan()?.totalCapital ?? 0)) setCapitalRaw(String(seedCapital))
  }, [seedCapital])

  const codeList = useMemo(() => parseCodes(codesText), [codesText])
  const totalCapital = Math.max(0, Number(capital || 0))
  // 이어받은 종목 자동 생성은 투자금이 정해진 뒤에 한다 — 예전엔 시드 조회 전 기본값 1천만원으로 수량을 계산했다
  // 시드가 있으면 투자금 칸에 실제로 반영된 뒤여야 한다(반영은 다음 효과에서 일어난다)
  const seedApplied = !seedCapital || capital === String(seedCapital)
  const capitalReady = capitalFromPlan || capitalEditedRef.current || (seedLoaded && seedApplied)

  return {
    codesText, setCodesText, capital, setCapital, maxWeightPct, setMaxWeightPct, splitCount, setSplitCount,
    riskMode, setRiskMode, sourceLabel, setSourceLabel, includeNews, setIncludeNews,
    hydratedByPending, setHydratedByPending, codeList, totalCapital, capitalReady,
  }
}
