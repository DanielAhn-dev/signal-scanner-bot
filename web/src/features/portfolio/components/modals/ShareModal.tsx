import { formatKrw, formatKrwCompact, formatKstDateTime, formatNumber } from '../../../../lib/format'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/Modal'
import { useToast } from '../../../../components/ToastProvider'
import type { PortfolioShareHistoryItem } from '../../types'
import { formatSignedKrw } from '../../lib/format'

type ShareModalProps = {
  shareModalOpen: boolean
  setShareModalOpen: (open: boolean) => void
  captureGeneratedAt: string
  holdingAll: any[]
  shareTtlHours: number
  setShareTtlHours: (v: number) => void
  shareCreating: boolean
  sharedSummaryUrl: string
  shareExpiresAt: string
  createPublicShareUrl: () => void
  copyPortfolioShareUrl: () => void
  loadShareHistory: () => void
  shareHistoryLoading: boolean
  shareHistory: PortfolioShareHistoryItem[]
  revokeShare: (shareId: string) => void
  deleteShare: (shareId: string) => void
  revokingShareId: string
  deletingShareId: string
  totalInvested: number
  totalUnrealized: number
  totalReturnPct: number
}

export default function ShareModal({
  shareModalOpen,
  setShareModalOpen,
  captureGeneratedAt,
  holdingAll,
  shareTtlHours,
  setShareTtlHours,
  shareCreating,
  sharedSummaryUrl,
  shareExpiresAt,
  createPublicShareUrl,
  copyPortfolioShareUrl,
  loadShareHistory,
  shareHistoryLoading,
  shareHistory,
  revokeShare,
  deleteShare,
  revokingShareId,
  deletingShareId,
  totalInvested,
  totalUnrealized,
  totalReturnPct,
}: ShareModalProps) {
  const toast = useToast()
  return (
    <Modal
      isOpen={shareModalOpen}
      title="포트폴리오 공유 요약"
      onClose={() => setShareModalOpen(false)}
      size="lg"
    >
      <div className="portfolio-capture-card">
        <div className="portfolio-capture-top">
          <div>
            <div className="portfolio-capture-title">포트폴리오 요약</div>
            <div className="portfolio-capture-time">기준시각 {captureGeneratedAt}</div>
          </div>
            <div className="portfolio-capture-count">보유 {holdingAll.length}종목</div>
        </div>

        <div className="portfolio-share-control-grid">
          <div className="portfolio-share-ttl-field">
            <div className="caption muted" style={{ marginBottom: 'var(--space-1)' }}>링크 만료</div>
            <select
              className="input"
              value={String(shareTtlHours)}
              onChange={(e) => setShareTtlHours(Number(e.target.value) || 48)}
              disabled={shareCreating}
            >
              <option value="24">24시간</option>
              <option value="48">48시간</option>
              <option value="168">7일</option>
            </select>
          </div>

          <div className="portfolio-share-url-block">
            <div className="caption muted portfolio-share-url-label">공유 URL (인증 없이 접근 가능)</div>
            <div className="portfolio-share-url-row">
              <input
                className="ui-text portfolio-share-url-input"
                readOnly
                value={sharedSummaryUrl || (shareCreating ? '공유 URL 생성 중...' : '')}
              />
              <Button variant="secondary" onClick={createPublicShareUrl} disabled={shareCreating}>
                {shareCreating ? '생성 중...' : 'URL 재생성'}
              </Button>
              <Button variant="secondary" onClick={copyPortfolioShareUrl} disabled={!sharedSummaryUrl}>URL 복사</Button>
            </div>
          </div>
        </div>
        {shareExpiresAt && (
          <div className="caption muted" style={{ marginBottom: 'var(--space-3)' }}>
            링크 만료: {formatKstDateTime(shareExpiresAt)}
          </div>
        )}

        <div className="caption muted" style={{ marginBottom: 'var(--space-3)' }}>
          이 URL은 누구나 열람 가능한 공유 전용 단독 페이지입니다.
        </div>

        <div className="card" style={{ margin: 0, marginBottom: 'var(--space-3)', padding: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
            <div className="title-md">최근 공유 링크</div>
            <Button variant="secondary" onClick={() => { void loadShareHistory() }} disabled={shareHistoryLoading}>
              {shareHistoryLoading ? '조회 중...' : '새로고침'}
            </Button>
          </div>

          {shareHistory.length === 0 ? (
            <div className="caption muted">공유 이력이 없습니다.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--space-2)' }}>
              {shareHistory.map((item) => {
                const isRevoked = Boolean(item.revokedAt)
                const isExpired = new Date(item.expiresAt).getTime() <= Date.now()
                return (
                  <div key={item.shareId} className="portfolio-share-history-item">
                    <div className="portfolio-share-history-head">
                      <div className="caption">
                        생성 {formatKstDateTime(item.createdAt)}
                        {' · '}만료 {formatKstDateTime(item.expiresAt)}
                        {' · '}조회 {Number(item.accessCount || 0)}회
                      </div>
                      <div className={`portfolio-share-history-status ${isRevoked ? 'is-revoked' : isExpired ? 'is-expired' : 'is-active'}`}>
                        {isRevoked ? '철회됨' : isExpired ? '만료됨' : '활성'}
                      </div>
                    </div>
                    <div className="portfolio-share-history-url">{item.url}</div>
                    <div className="portfolio-share-history-actions">
                      <Button
                        variant="secondary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(String(item.url || ''))
                            toast.show('공유 URL을 복사했습니다')
                          } catch {
                            toast.show('공유 URL 복사에 실패했습니다')
                          }
                        }}
                      >
                        URL 복사
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => revokeShare(item.shareId)}
                        disabled={isRevoked || isExpired || revokingShareId === item.shareId || deletingShareId === item.shareId}
                      >
                        {isRevoked ? '철회됨' : isExpired ? '만료됨' : revokingShareId === item.shareId ? '철회 중...' : '철회'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => deleteShare(item.shareId)}
                        disabled={revokingShareId === item.shareId || deletingShareId === item.shareId}
                      >
                        {deletingShareId === item.shareId ? '삭제 중...' : '삭제'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="portfolio-capture-metrics">
          <div className="portfolio-capture-metric">
            <div className="portfolio-capture-label">총 매수원금</div>
            <div className="portfolio-capture-value">{formatKrwCompact(totalInvested)}</div>
          </div>
          <div className="portfolio-capture-metric">
            <div className="portfolio-capture-label">평가손익</div>
            <div className={`portfolio-capture-value ${totalUnrealized < 0 ? 'negative' : 'positive'}`}>
              {formatSignedKrw(totalUnrealized)}
            </div>
          </div>
          <div className="portfolio-capture-metric">
            <div className="portfolio-capture-label">현재 수익률</div>
            <div className={`portfolio-capture-value ${totalReturnPct < 0 ? 'negative' : 'positive'}`}>
              {`${totalReturnPct > 0 ? '+' : ''}${formatNumber(totalReturnPct, 2)}%`}
            </div>
          </div>
        </div>

        <div className="portfolio-capture-table-wrap">
          <table className="portfolio-capture-table">
            <thead>
              <tr>
                <th>종목명</th>
                <th>종목코드</th>
                <th>보유수량</th>
                <th>매수가</th>
                <th>매수일</th>
                <th>손익</th>
                <th>수익률</th>
              </tr>
            </thead>
            <tbody>
              {holdingAll.map((r: any) => {
                const pnl = Number(r.unrealized_pnl || 0)
                const pct = Number(r.unrealized_pct || 0)
                return (
                  <tr key={`capture-${r.id}`}>
                    <td>{r.stock_name ?? r.ticker ?? r.symbol ?? '-'}</td>
                    <td>{r.code || '-'}</td>
                    <td>{`${formatNumber(Number(r.quantity || 0), 0)}주`}</td>
                    <td>{formatKrw(Number(r.avg_price || 0))}</td>
                    <td>{r.buy_date || '-'}</td>
                    <td className={pnl < 0 ? 'negative' : pnl > 0 ? 'positive' : ''}>{formatSignedKrw(pnl)}</td>
                    <td className={pct < 0 ? 'negative' : pct > 0 ? 'positive' : ''}>{`${pct > 0 ? '+' : ''}${formatNumber(pct, 2)}%`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  )
}
