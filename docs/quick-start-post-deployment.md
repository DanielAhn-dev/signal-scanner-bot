# 배포 후 운영자 빠른 시작 (5분)

2026-04-24 무료플랜 배포 후 즉시 확인사항

## 1. 봇 반응 확인 (지금 바로)

Telegram에서:

```
/자동사이클 실행
```

**예상 응답:**
```
2026-04-24 자동사이클 [실행]
- 총 사용자 X명 중 처리 Y명
- 매수 A건 · 매도 B건 · 스킵 C건

[보유] [보유대응] [최근 기록] [자동 점검]
```

**버튼 동작 확인:**
- `자동 점검` 클릭 → dry-run 결과 조회

## 2. 야간 자동 cron 로그 확인

**Vercel 대시보드에서:**
1. Deployments 탭 → Function Logs
2. `/api/cron/virtualAutoTrade` 검색
3. 최근 로그에서 `scope=autocycle_cron` 확인

**예상 로그:**
```json
{
  "scope": "autocycle_cron",
  "event": "cycle_done",
  "ts": "2026-04-24T23:45:00Z",
  "processed_users": 10,
  "buy_count": 2,
  "sell_count": 1,
  "skipped_count": 5
}
```

## 3. 운영자 알림 설정 (선택)

비정상 감지 시 Telegram으로 알림받으려면:

1. Telegram에서 원하는 채팅방/채널 열기
2. 메시지 우클릭 → 메시지 정보 → Chat ID 복사 (숫자)
3. Vercel 대시보드 → Settings → Environment Variables
4. `AUTO_TRADE_ALERT_CHAT_ID=<복사한숫자>` 추가
5. 재배포 (자동 또는 수동)

## 4. 현재 상태 한 줄 정리

| 항목 | 상태 | 비고 |
|-----|------|------|
| **Telegram 봇** | ✅ 배포됨 | 사용자 수동 트리거 |
| **야간 자동 cron** | ✅ 활성 | 23:45 매일 실행 |
| **장중 자동 cron** | ❌ 무료플랜 제약 | 사용자 버튼 필요 |
| **운영자 알림** | ⚙️ 선택사항 | AUTO_TRADE_ALERT_CHAT_ID 필요 |
| **아침 briefing** | ✅ 06:10 실행 | 스킵 사유 요약 포함 |

## 문제 발생 시

| 증상 | 확인사항 |
|------|---------|
| 봇이 응답 안 함 | Telegram 메시지 로그 확인 (api/worker.ts) |
| 야간 cron이 안 돔 | Vercel 함수 로그에서 `cycle_failed` 검색 |
| 버튼이 안 눌림 | callback router 권한 확인 (api/worker.ts) |
| 운영자 알림 안 옴 | AUTO_TRADE_ALERT_CHAT_ID 환경변수 확인 |

---

**상세 가이드**: [docs/current-deployment-status.md](./current-deployment-status.md)  
**검증 체크리스트**: [docs/deployment-verification-checklist.md](./deployment-verification-checklist.md)
