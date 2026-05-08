import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { shareToKakaotalk, preloadKakaoSdk, shareToTwitter, copyToClipboard, shareViaWebAPI, type ShareData } from '../lib/share'
import { useToast } from './ToastProvider'

interface Props {
  data: ShareData
  variant?: 'icon' | 'button' | 'compact' // icon: 아이콘만, button: 버튼, compact: 작은 버튼
  showLabel?: boolean // 라벨 표시 여부
  className?: string
}

export default function ShareButtons({ data, variant = 'button', showLabel = true, className = '' }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const toast = useToast()

  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // 모달 열릴 때 SDK 미리 로드 (카카오 버튼 클릭 시 await 없이 진행하기 위함)
    preloadKakaoSdk()
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen])

  const handleKakaotalk = async () => {
    try {
      await shareToKakaotalk(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '카카오톡 공유에 실패했습니다.'
      toast.show(msg, 4000)
    }
    setIsOpen(false)
  }

  const handleTwitter = () => {
    try {
      shareToTwitter(data)
    } catch (e) {
      toast.show('Twitter 공유에 실패했습니다.', 3000)
    }
    setIsOpen(false)
  }

  const handleWebShare = async () => {
    try {
      const success = await shareViaWebAPI(data)
      if (!success) {
        toast.show('웹 공유 기능이 지원되지 않습니다.', 3000)
      }
      setIsOpen(false)
    } catch (e) {
      toast.show('공유에 실패했습니다.', 3000)
    }
  }

  const handleCopy = async () => {
    try {
      const success = await copyToClipboard(data)
      if (success) {
        setCopied(true)
        toast.show('클립보드에 복사됐습니다.', 2000)
        setTimeout(() => setCopied(false), 2000)
      } else {
        toast.show('복사에 실패했습니다.', 3000)
      }
    } catch (e) {
      toast.show('복사 중 오류가 발생했습니다.', 3000)
    }
    setIsOpen(false)
  }

  const buttonClass = variant === 'compact' ? 'ui-button ui-btn-ghost' : 'ui-button ui-btn-secondary'

  if (variant === 'icon') {
    return (
      <div className={`share-buttons-row ${className}`}>
        <button
          className="share-icon-btn share-icon-kakao"
          onClick={handleKakaotalk}
          title="카카오톡 공유"
          aria-label="카카오톡 공유"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M10 2C5.58 2 2 5.08 2 8.8c0 2.24 1.36 4.2 3.5 5.16l-.56 2.8c-.08.4.32.76.72.56l3.2-1.88c.56.08 1.12.12 1.72.12 4.42 0 8-3.08 8-6.8S14.42 2 10 2z" />
          </svg>
        </button>
        <button
          className="share-icon-btn share-icon-twitter"
          onClick={handleTwitter}
          title="X(Twitter) 공유"
          aria-label="X(Twitter) 공유"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M15.05 2H17.8L12.46 8.29L18.88 18H13.5L9.1 12.46L4.07 18H1.3l5.65-6.47L1.38 2h5.51l3.99 5.29L15.05 2zm-1.08 16h1.48L5.08 3.5H3.5l10.47 14.5z" />
          </svg>
        </button>
        <button
          className="share-icon-btn share-icon-copy"
          onClick={handleCopy}
          title="링크 복사"
          aria-label="링크 복사"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M8 14c-1.104 0-2-1.119-2-2.5V6.5C6 5.119 6.896 4 8 4h5c1.104 0 2 1.119 2 2.5v5C15 13.881 14.104 15 13 15H8z" />
            <path d="M4 11.5c0 1.381.896 2.5 2 2.5M4 11.5C4 12.881 4.896 14 6 14m0-9c0 1.381-.896 2.5-2 2.5M6 5C6 3.619 5.104 2.5 4 2.5" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className={`share-buttons ${className}`}>
      <button
        className={buttonClass}
        onClick={() => setIsOpen(!isOpen)}
        title="공유하기"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="18" cy="5" r="3"/>
          <circle cx="6" cy="12" r="3"/>
          <circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        {showLabel && '공유'}
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="share-modal-overlay"
          ref={overlayRef}
          onClick={e => e.target === overlayRef.current && setIsOpen(false)}
        >
          <div className="share-modal" role="dialog" aria-label="공유 옵션" aria-modal="true">
            <div className="share-modal-header">
              <h3 className="share-modal-title">공유하기</h3>
              <button
                className="share-modal-close"
                onClick={() => setIsOpen(false)}
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            <div className="share-modal-body">
              <button
                className="share-option"
                onClick={handleKakaotalk}
              >
                <div className="share-option-icon share-option-kakao">
                  <svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                    <path d="M10 2C5.58 2 2 5.08 2 8.8c0 2.24 1.36 4.2 3.5 5.16l-.56 2.8c-.08.4.32.76.72.56l3.2-1.88c.56.08 1.12.12 1.72.12 4.42 0 8-3.08 8-6.8S14.42 2 10 2z" />
                  </svg>
                </div>
                <div className="share-option-text">
                  <div className="share-option-label">카카오톡</div>
                  <div className="share-option-desc">친구에게 공유</div>
                </div>
              </button>

              <button
                className="share-option"
                onClick={handleTwitter}
              >
                <div className="share-option-icon share-option-twitter">
                  <svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                    <path d="M15.05 2H17.8L12.46 8.29L18.88 18H13.5L9.1 12.46L4.07 18H1.3l5.65-6.47L1.38 2h5.51l3.99 5.29L15.05 2zm-1.08 16h1.48L5.08 3.5H3.5l10.47 14.5z" />
                  </svg>
                </div>
                <div className="share-option-text">
                  <div className="share-option-label">X(Twitter)</div>
                  <div className="share-option-desc">트윗으로 공유</div>
                </div>
              </button>

              <button
                className="share-option"
                onClick={handleCopy}
              >
                <div className="share-option-icon share-option-copy">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                  </svg>
                </div>
                <div className="share-option-text">
                  <div className="share-option-label">{copied ? '✓ 복사됨' : '링크 복사'}</div>
                  <div className="share-option-desc">클립보드에 저장</div>
                </div>
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <style>{`
        .share-buttons {
          position: relative;
          display: inline-block;
        }

        .share-buttons-row {
          display: flex;
          gap: var(--space-2);
          align-items: center;
        }

        .share-icon-btn {
          background: none;
          border: none;
          padding: 4px;
          cursor: pointer;
          color: var(--color-text-secondary);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          transition: all 0.2s ease;
        }

        .share-icon-btn:hover {
          background: var(--color-bg-hover);
          color: var(--color-text-primary);
        }

        .share-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: var(--color-bg-overlay);
          display: flex;
          align-items: flex-end;
          z-index: var(--z-modal);
        }

        .share-modal {
          background: var(--color-bg-elevated);
          border: 1px solid var(--color-border-default);
          border-radius: 12px 12px 0 0;
          width: 100%;
          max-width: 480px;
          max-height: 80vh;
          overflow-y: auto;
          box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.15);
        }

        @media (min-width: 768px) {
          .share-modal-overlay {
            align-items: center;
            justify-content: center;
          }

          .share-modal {
            border-radius: 12px;
            max-width: 400px;
            width: auto;
          }
        }

        .share-modal-header {
          padding: var(--space-4);
          border-bottom: 1px solid var(--color-border-default);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .share-modal-title {
          margin: 0;
          font-size: var(--font-size-lg);
          font-weight: var(--font-weight-bold);
        }

        .share-modal-close {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 20px;
          color: var(--color-text-secondary);
          padding: 0;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          transition: all 0.2s ease;
        }

        .share-modal-close:hover {
          background: var(--color-bg-hover);
          color: var(--color-text-primary);
        }

        .share-modal-body {
          padding: var(--space-4);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .share-option {
          display: flex;
          gap: var(--space-3);
          align-items: center;
          padding: var(--space-3);
          background: var(--color-bg-sunken);
          border: 1px solid var(--color-border-default);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
        }

        .share-option:hover {
          background: var(--color-bg-hover);
          border-color: var(--color-text-secondary);
        }

        .share-option-icon {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .share-option-kakao {
          background: #FFE812;
          color: #3C1E1E;
        }

        .share-option-twitter {
          background: #000;
          color: #fff;
        }

        .share-option-copy {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
        }

        .share-option-text {
          flex: 1;
        }

        .share-option-label {
          font-weight: var(--font-weight-600);
          font-size: var(--font-size-base);
          color: var(--color-text-primary);
        }

        .share-option-desc {
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          margin-top: 2px;
        }
      `}</style>
    </div>
  )
}
