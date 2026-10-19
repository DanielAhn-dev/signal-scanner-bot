import './account-tag.css'

/**
 * [실제] / [가상] 계좌 표시 — 색이 아니라 글자로 구분한다(2026-10-19 원칙).
 * 실제 = 내가 증권사에서 직접 사는 내 계좌, 가상 = 봇이 '내 계획'대로 자동으로 사는 가상 계좌.
 */
export default function AccountTag({ kind }: { kind: 'real' | 'virtual' }) {
  return <span className={`account-tag account-tag--${kind}`}>{kind === 'real' ? '실제' : '가상'}</span>
}
