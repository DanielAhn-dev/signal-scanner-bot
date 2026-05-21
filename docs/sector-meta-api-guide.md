# 섹터 메타데이터 API 교체 가이드

현재 섹터 가이드 / 전체 섹터 탭은 `web/src/features/sectors/sectorMeta.ts` 의 정적 데이터를 사용합니다.
관리자가 경기 국면(currentPhase)을 직접 설정하거나 데이터를 동적으로 변경하려면 아래 절차로 백엔드 API로 교체하세요.

---

## API 계약

### 엔드포인트

```
GET /api/ui/sector-meta
```

### 응답 타입 (TypeScript)

```typescript
interface SectorMetaResponse {
  sectors: SectorMeta[]
  rotationCycle: RotationPhase[]
  macroSensitivity: MacroSensitivity
  currentPhase?: EconomicPhase  // 관리자가 설정한 현재 경기 국면 (optional)
}
```

각 타입의 상세 정의는 `web/src/features/sectors/sectorMeta.ts` 상단 참조.

---

## 교체 절차

### 1. 백엔드: 핸들러 추가

`handlers/ui/sector-meta.ts` 파일 생성:

```typescript
import { Request, Response } from "express"
import { SECTOR_META_DATA, ROTATION_CYCLE, MACRO_SENSITIVITY } from "../../data/sectorMeta"  // DB or JSON

export async function handleSectorMeta(req: Request, res: Response) {
  const currentPhase = await getSetting("sector_current_phase")  // DB에서 읽기
  res.json({
    sectors: SECTOR_META_DATA,
    rotationCycle: ROTATION_CYCLE,
    macroSensitivity: MACRO_SENSITIVITY,
    currentPhase: currentPhase ?? undefined,
  })
}
```

### 2. 프론트엔드: 훅 교체

`web/src/features/sectors/sectorMeta.ts`에서 import 하는 부분을 훅으로 교체:

```typescript
// useSectorMeta.ts (새 파일)
import { useState, useEffect } from "react"
import { apiFetch } from "../../lib/api"
import {
  SECTOR_META_DATA,
  ROTATION_CYCLE,
  MACRO_SENSITIVITY,
  type SectorMeta,
  type RotationPhase,
  type MacroSensitivity,
  type EconomicPhase,
} from "./sectorMeta"

interface SectorMetaState {
  sectors: SectorMeta[]
  rotationCycle: RotationPhase[]
  macroSensitivity: MacroSensitivity
  currentPhase?: EconomicPhase
}

const FALLBACK: SectorMetaState = {
  sectors: SECTOR_META_DATA,
  rotationCycle: ROTATION_CYCLE,
  macroSensitivity: MACRO_SENSITIVITY,
}

export function useSectorMeta(): SectorMetaState {
  const [state, setState] = useState<SectorMetaState>(FALLBACK)

  useEffect(() => {
    apiFetch("/api/ui/sector-meta", { cacheMs: 300_000 })
      .then((res) => setState(res ?? FALLBACK))
      .catch(() => {})  // API 실패 시 정적 데이터 유지
  }, [])

  return state
}
```

### 3. SectorsPage에서 훅 적용

`index.tsx`에서:

```typescript
// 기존 (직접 import)
import { SECTOR_META_DATA, ROTATION_CYCLE, MACRO_SENSITIVITY, getSectorMeta } from "./sectorMeta"

// 교체 후 (훅 사용)
import { useSectorMeta } from "./useSectorMeta"
// ...
const { sectors, rotationCycle, macroSensitivity, currentPhase } = useSectorMeta()
```

그 다음 `SectorGuideView`에 `rotationCycle`, `macroSensitivity`, `currentPhase`를 props로 전달.

---

## currentPhase UI 반영

`currentPhase`가 API에서 내려오면 섹터 가이드 탭의 로테이션 사이클 카드에서
현재 국면을 강조 표시합니다:

```tsx
// rotation-phase-card 에 active 클래스 추가
<div
  className={`rotation-phase-card${currentPhase === phase.phase ? " rotation-phase-card--active" : ""}`}
  ...
>
```

CSS:
```css
.rotation-phase-card--active {
  box-shadow: 0 0 0 3px var(--phase-color);
  background: var(--color-bg-sunken);
}
```

---

## 관리자 설정 방법 (예시)

DB의 `settings` 테이블에 `sector_current_phase` 키를 추가:

```sql
INSERT INTO settings (key, value) VALUES ('sector_current_phase', 'recovery');
-- 가능한 값: 'recovery' | 'expansion' | 'slowdown' | 'recession'
```

또는 텔레그램 관리자 커맨드로 설정:

```
/admin set sector_phase recovery
```
