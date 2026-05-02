# Design Tokens — Signal Scanner Bot Web UI

> **상태**: 초안 (Draft v0.1)  
> **기준 스타일**: 토스증권 계열 모던 금융 UI  
> **최종 수정**: 2026-05-01  
> **구현 파일**: `web/src/styles/tokens.css`

---

## 목차

1. [철학 및 원칙](#1-철학-및-원칙)
2. [색상 토큰](#2-색상-토큰)
3. [타이포그래피 토큰](#3-타이포그래피-토큰)
4. [간격(Spacing) 토큰](#4-간격spacing-토큰)
5. [모서리 반경 토큰](#5-모서리-반경-토큰)
6. [그림자 토큰](#6-그림자-토큰)
7. [모션 토큰](#7-모션-토큰)
8. [레이어(Z-index) 토큰](#8-레이어z-index-토큰)
9. [반응형 브레이크포인트](#9-반응형-브레이크포인트)
10. [컴포넌트별 토큰 사용 가이드](#10-컴포넌트별-토큰-사용-가이드)
11. [다크모드 고려사항](#11-다크모드-고려사항)
12. [토큰 변경 프로세스](#12-토큰-변경-프로세스)

---

## 1. 철학 및 원칙

### 디자인 철학

금융 데이터는 **신뢰성**과 **가독성**이 최우선이다.  
토스증권 스타일을 기반으로 다음 세 가지를 중심에 둔다.

| 원칙 | 설명 |
|------|------|
| **명확성** | 수치와 상태가 한눈에 들어와야 한다. 장식보다 정보. |
| **일관성** | 같은 의미는 항상 같은 토큰을 쓴다. 컴포넌트마다 다른 색·크기를 쓰지 않는다. |
| **절제** | 컬러는 의미가 있을 때만 쓴다. 흰 공간을 아끼지 않는다. |

### 토큰 계층 구조

```
Primitive (원시값)
  └─ Semantic (의미 부여)
       └─ Component (컴포넌트 전용)
```

- **Primitive**: 팔레트의 순수 색상값, 크기값 (`--color-blue-500: #0060FF`)
- **Semantic**: 역할을 나타냄 (`--color-brand: var(--color-blue-500)`)
- **Component**: 특정 컴포넌트에서만 사용 (`--btn-primary-bg: var(--color-brand)`)

> **규칙**: 컴포넌트 CSS에서는 반드시 Semantic 또는 Component 토큰만 참조한다.  
> Primitive 토큰을 컴포넌트에서 직접 쓰지 않는다.

---

## 2. 색상 토큰

### 2-1. 한국 주식 색상 규약 (중요)

> 한국 주식 시장은 서양과 반대 규약을 사용한다.

| 의미 | 한국 관례 | 서양 관례 | 본 프로젝트 |
|------|----------|----------|-------------|
| 상승 (Positive) | **빨강** 🔴 | 초록 | **빨강** (한국 규약 따름) |
| 하락 (Negative) | **파랑** 🔵 | 빨강 | **파랑** (한국 규약 따름) |
| 보합 (Neutral) | 회색 | 회색 | 회색 |

```css
/* 절대로 뒤바꾸지 않는다 — 이 규약은 한국 투자자에게 직관적 기준임 */
--color-stock-up:     #F04452;   /* 상승 = 빨강 */
--color-stock-down:   #1478FF;   /* 하락 = 파랑 */
--color-stock-flat:   #8B95A1;   /* 보합 = 회색 */
```

---

### 2-2. Primitive 팔레트 (원시 색상)

아래 값들은 직접 사용하지 않는다. Semantic 토큰을 통해 참조한다.

```css
/* ── Blue (브랜드 계열) ── */
--color-blue-50:  #EBF3FF;
--color-blue-100: #C2D9FF;
--color-blue-200: #85AEFF;
--color-blue-300: #4D85FF;
--color-blue-400: #1F63FF;
--color-blue-500: #0060FF;   /* 토스 시그니처 블루 */
--color-blue-600: #0052DB;
--color-blue-700: #003FAD;
--color-blue-800: #002D80;
--color-blue-900: #001B52;

/* ── Red (상승/경고 계열) ── */
--color-red-50:  #FFF0F1;
--color-red-100: #FFD6D9;
--color-red-200: #FFB0B6;
--color-red-300: #FF7F89;
--color-red-400: #F85C68;
--color-red-500: #F04452;   /* 상승 기준 */
--color-red-600: #D0313E;
--color-red-700: #A82130;
--color-red-800: #7D1522;
--color-red-900: #520A13;

/* ── Gray (중립/배경 계열) ── */
--color-gray-0:   #FFFFFF;
--color-gray-50:  #F9FAFB;
--color-gray-100: #F2F4F6;
--color-gray-200: #E5E8EB;
--color-gray-300: #D1D5DB;
--color-gray-400: #B0B8C1;
--color-gray-500: #8B95A1;
--color-gray-600: #6B7280;
--color-gray-700: #4E5968;
--color-gray-800: #333D4B;
--color-gray-900: #191F28;   /* 본문 텍스트 */
--color-gray-950: #0D1117;

/* ── Green (확인/완료 — 색상 의미 주의, 주식 상승에 쓰지 않는다) ── */
--color-green-500: #00B493;
--color-green-600: #009E80;

/* ── Orange (경고) ── */
--color-orange-500: #FF6B35;
--color-orange-600: #E85D2A;

/* ── Yellow (주의) ── */
--color-yellow-500: #F5B800;
```

---

### 2-3. Semantic 색상 토큰 (의미 기반)

```css
/* ════════════════════════════════
   브랜드
   ════════════════════════════════ */
--color-brand:          var(--color-blue-500);
--color-brand-hover:    var(--color-blue-600);
--color-brand-active:   var(--color-blue-700);
--color-brand-subtle:   var(--color-blue-50);
--color-brand-muted:    var(--color-blue-200);

/* ════════════════════════════════
   배경 (Background)
   ════════════════════════════════ */
--color-bg-page:        var(--color-gray-100);   /* 전체 페이지 배경 */
--color-bg-surface:     var(--color-gray-0);     /* 카드, 패널 배경 */
--color-bg-elevated:    var(--color-gray-0);     /* 모달, 드롭다운 */
--color-bg-sunken:      var(--color-gray-50);    /* 인풋 배경 (비활성) */
--color-bg-overlay:     rgba(0, 0, 0, 0.4);      /* 모달 오버레이 */

/* ════════════════════════════════
   테두리 (Border)
   ════════════════════════════════ */
--color-border-default: var(--color-gray-200);   /* 기본 구분선 */
--color-border-strong:  var(--color-gray-300);   /* 강조 구분선 */
--color-border-focus:   var(--color-brand);      /* 포커스 링 */
--color-border-error:   var(--color-red-500);

/* ════════════════════════════════
   텍스트 (Text)
   ════════════════════════════════ */
--color-text-primary:   var(--color-gray-900);   /* 본문 */
--color-text-secondary: var(--color-gray-600);   /* 보조 설명 */
--color-text-tertiary:  var(--color-gray-500);   /* 힌트, 플레이스홀더 */
--color-text-disabled:  var(--color-gray-400);
--color-text-inverse:   var(--color-gray-0);     /* 어두운 배경 위 텍스트 */
--color-text-brand:     var(--color-brand);

/* ════════════════════════════════
   주식 상태 (Stock State)
   ════════════════════════════════ */
--color-stock-up:       #F04452;                 /* 상승 */
--color-stock-up-bg:    #FFF0F1;                 /* 상승 배경 (배지 등) */
--color-stock-down:     #1478FF;                 /* 하락 */
--color-stock-down-bg:  #EBF3FF;                 /* 하락 배경 */
--color-stock-flat:     var(--color-gray-500);   /* 보합 */
--color-stock-flat-bg:  var(--color-gray-100);

/* ════════════════════════════════
   시스템 상태 (Feedback)
   ════════════════════════════════ */
--color-success:        var(--color-green-500);
--color-success-bg:     #E6F9F5;
--color-warning:        var(--color-orange-500);
--color-warning-bg:     #FFF4EE;
--color-error:          var(--color-red-500);
--color-error-bg:       var(--color-red-50);
--color-info:           var(--color-brand);
--color-info-bg:        var(--color-brand-subtle);
```

---

## 3. 타이포그래피 토큰

### 3-1. 폰트 패밀리

> Pretendard는 한국 핀테크 표준 폰트. 시스템 폰트보다 금융 숫자 가독성이 훨씬 높다.

```css
--font-family-sans:
  'Pretendard Variable', 'Pretendard',
  -apple-system, BlinkMacSystemFont, 'Segoe UI',
  'Helvetica Neue', Arial, sans-serif;

--font-family-mono:
  'JetBrains Mono', 'Fira Code', 'Cascadia Code',
  'Consolas', 'Courier New', monospace;
  /* 수치 데이터 표 등에서 사용 */

--font-family-number: var(--font-family-sans);
  /* 금융 수치는 sans-serif로 통일, tabular-nums 적용 */
```

**Pretendard 로드 방법 (index.html):**
```html
<link rel="preconnect" href="https://cdn.jsdelivr.net" />
<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
/>
```

---

### 3-2. 폰트 크기 스케일

```css
--font-size-xs:   0.75rem;    /* 12px — 캡션, 태그 */
--font-size-sm:   0.875rem;   /* 14px — 보조 텍스트, 레이블 */
--font-size-base: 1rem;       /* 16px — 본문 */
--font-size-md:   1.0625rem;  /* 17px — 약간 강조된 본문 */
--font-size-lg:   1.125rem;   /* 18px — 소제목 */
--font-size-xl:   1.25rem;    /* 20px — 제목 */
--font-size-2xl:  1.5rem;     /* 24px — 페이지 제목 */
--font-size-3xl:  1.875rem;   /* 30px — 대형 수치 */
--font-size-4xl:  2.25rem;    /* 36px — 히어로 수치 (포트폴리오 총자산 등) */
```

---

### 3-3. 폰트 굵기

```css
--font-weight-regular:   400;
--font-weight-medium:    500;
--font-weight-semibold:  600;
--font-weight-bold:      700;
--font-weight-extrabold: 800;
```

---

### 3-4. 줄 간격 (Line Height)

```css
--line-height-tight:   1.2;   /* 제목, 큰 수치 */
--line-height-snug:    1.375; /* 서브제목 */
--line-height-normal:  1.5;   /* 본문 기본 */
--line-height-relaxed: 1.625; /* 긴 설명문 */
```

---

### 3-5. 글자 간격 (Letter Spacing)

```css
--letter-spacing-tight:  -0.02em;  /* 대형 제목에서 자간 축소 */
--letter-spacing-normal:  0;
--letter-spacing-wide:    0.02em;   /* 영문 소문자 캡션 */
--letter-spacing-wider:   0.05em;   /* 섹션 레이블, 배지 */
```

---

### 3-6. 숫자 렌더링 (금융 수치)

```css
/* 숫자가 들어가는 모든 요소에 적용 */
.number, .price, .pnl, td.numeric {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}
```

---

### 3-7. 텍스트 스타일 조합 (Typography Scale)

| 역할 | 크기 | 굵기 | 줄간격 | 사용처 |
|------|------|------|--------|--------|
| `display` | 4xl | extrabold | tight | 총자산, 히어로 숫자 |
| `heading-1` | 2xl | bold | tight | 페이지 타이틀 |
| `heading-2` | xl | semibold | snug | 섹션 제목 |
| `heading-3` | lg | semibold | snug | 카드 제목 |
| `body-lg` | md | regular | normal | 강조 본문 |
| `body` | base | regular | normal | 기본 본문 |
| `body-sm` | sm | regular | normal | 보조 설명 |
| `caption` | xs | regular | normal | 타임스탬프, 힌트 |
| `label` | sm | medium | tight | 폼 레이블, 배지 |
| `numeric-lg` | 3xl | bold | tight | 수익률, 잔고 강조 |
| `numeric` | base | semibold | tight | 테이블 수치 |

---

## 4. 간격(Spacing) 토큰

4px 기반 그리드를 사용한다.

```css
--space-0:   0;
--space-1:   0.25rem;   /* 4px */
--space-2:   0.5rem;    /* 8px */
--space-3:   0.75rem;   /* 12px */
--space-4:   1rem;      /* 16px */
--space-5:   1.25rem;   /* 20px */
--space-6:   1.5rem;    /* 24px */
--space-8:   2rem;      /* 32px */
--space-10:  2.5rem;    /* 40px */
--space-12:  3rem;      /* 48px */
--space-16:  4rem;      /* 64px */
--space-20:  5rem;      /* 80px */
--space-24:  6rem;      /* 96px */
```

### 시맨틱 간격 (Semantic Spacing)

```css
/* 카드 내부 패딩 */
--spacing-card-sm:    var(--space-4);   /* 16px — 컴팩트 카드 */
--spacing-card-md:    var(--space-5);   /* 20px — 기본 카드 */
--spacing-card-lg:    var(--space-6);   /* 24px — 넓은 카드 */

/* 페이지 여백 */
--spacing-page-x:     var(--space-4);   /* 좌우 */
--spacing-page-y:     var(--space-4);   /* 상하 */

/* 섹션 간격 */
--spacing-section:    var(--space-8);   /* 섹션 사이 */

/* 요소 간격 */
--spacing-stack-xs:   var(--space-1);   /* 4px — 아이콘+레이블 */
--spacing-stack-sm:   var(--space-2);   /* 8px — 폼 필드 내부 */
--spacing-stack-md:   var(--space-3);   /* 12px — 카드 내 요소 */
--spacing-stack-lg:   var(--space-4);   /* 16px — 카드 사이 */

/* 인라인 간격 */
--spacing-inline-xs:  var(--space-1);
--spacing-inline-sm:  var(--space-2);
--spacing-inline-md:  var(--space-3);
```

---

## 5. 모서리 반경 토큰

```css
--radius-none:   0;
--radius-xs:     4px;    /* 인풋, 배지 */
--radius-sm:     6px;    /* 버튼, 태그 */
--radius-md:     8px;    /* 기본 카드 */
--radius-lg:     12px;   /* 강조 카드, 바텀시트 */
--radius-xl:     16px;   /* 모달 */
--radius-2xl:    20px;   /* 대형 패널 */
--radius-full:   9999px; /* 칩, 아바타, 토글 */
```

### 사용 지침

| 컴포넌트 | 토큰 |
|----------|------|
| 인풋, 선택박스 | `--radius-xs` |
| 버튼 (소형) | `--radius-sm` |
| 버튼 (기본) | `--radius-sm` |
| 기본 카드 | `--radius-md` |
| 요약 카드, 알림 | `--radius-lg` |
| 바텀시트, 모달 | `--radius-xl` |
| 배지, 태그, 칩 | `--radius-full` |
| 아바타 | `--radius-full` |

---

## 6. 그림자 토큰

토스 스타일은 그림자를 최소화하고 경계선과 배경색으로 구분한다.

```css
--shadow-none:   none;

/* 카드 기본: 아주 얕고 부드러운 그림자 */
--shadow-xs:     0 1px 2px rgba(0, 0, 0, 0.04);

/* 카드 hover, 버튼 기본 */
--shadow-sm:     0 1px 4px rgba(0, 0, 0, 0.06),
                 0 1px 2px rgba(0, 0, 0, 0.04);

/* 드롭다운, 팝오버 */
--shadow-md:     0 4px 12px rgba(0, 0, 0, 0.08),
                 0 2px 4px rgba(0, 0, 0, 0.04);

/* 모달, 토스트 */
--shadow-lg:     0 8px 24px rgba(0, 0, 0, 0.10),
                 0 4px 8px rgba(0, 0, 0, 0.06);

/* 포커스 링 (브랜드 컬러) */
--shadow-focus:  0 0 0 3px rgba(0, 96, 255, 0.20);

/* 포커스 링 (에러) */
--shadow-focus-error: 0 0 0 3px rgba(240, 68, 82, 0.20);
```

---

## 7. 모션 토큰

```css
/* Duration */
--duration-instant:  0ms;
--duration-fast:     100ms;   /* 마이크로 인터랙션 (클릭, 체크) */
--duration-normal:   200ms;   /* 기본 트랜지션 (hover, 토글) */
--duration-slow:     300ms;   /* 패널 열기/닫기, 페이지 전환 */
--duration-slower:   500ms;   /* 차트 애니메이션 */

/* Easing */
--ease-default:    cubic-bezier(0.16, 1, 0.3, 1);   /* 스프링감 있는 기본 */
--ease-in:         cubic-bezier(0.4, 0, 1, 1);       /* 들어갈 때 */
--ease-out:        cubic-bezier(0, 0, 0.2, 1);       /* 나올 때 */
--ease-in-out:     cubic-bezier(0.4, 0, 0.2, 1);     /* 상태 변경 */
--ease-spring:     cubic-bezier(0.34, 1.56, 0.64, 1); /* 스프링 (토스 스타일) */

/* 접근성: prefers-reduced-motion */
@media (prefers-reduced-motion: reduce) {
  --duration-fast:   0ms;
  --duration-normal: 0ms;
  --duration-slow:   0ms;
  --duration-slower: 0ms;
}
```

---

## 8. 레이어(Z-index) 토큰

```css
--z-base:       0;
--z-raised:     10;    /* 카드 hover 상태 */
--z-dropdown:   100;   /* 드롭다운, 팝오버 */
--z-sticky:     200;   /* 스티키 헤더 */
--z-overlay:    300;   /* 배경 오버레이 */
--z-modal:      400;   /* 모달 */
--z-toast:      500;   /* 토스트 알림 */
--z-tooltip:    600;   /* 툴팁 (항상 최상위) */
```

---

## 9. 반응형 브레이크포인트

모바일 퍼스트 접근. 작은 화면에서 시작해서 큰 화면으로 확장.

```css
/* breakpoint 값 자체는 CSS 변수로 쓸 수 없으므로, 아래 상수를 문서로 관리 */

/* xs: 0px — 모바일 기본 (min-width 없이 작성) */
/* sm: 480px — 큰 모바일, 세로 태블릿 */
/* md: 640px — 가로 태블릿 */
/* lg: 1024px — 데스크탑 */
/* xl: 1280px — 넓은 데스크탑 */
```

Tailwind config에서의 정의:

```js
// tailwind.config.cjs
theme: {
  screens: {
    'sm': '480px',
    'md': '640px',
    'lg': '1024px',
    'xl': '1280px',
  }
}
```

### 컨테이너 최대 너비

| 페이지 유형 | 최대 너비 | 설명 |
|-------------|----------|------|
| 기본 레이아웃 | 48rem (768px) | 현재 기준 |
| 데이터 대시보드 | 64rem (1024px) | 차트가 많을 경우 |
| 전체 너비 | 100% | 테이블 전용 페이지 |

---

## 10. 컴포넌트별 토큰 사용 가이드

### Button

```css
/* Primary */
--btn-primary-bg:         var(--color-brand);
--btn-primary-bg-hover:   var(--color-brand-hover);
--btn-primary-bg-active:  var(--color-brand-active);
--btn-primary-text:       var(--color-text-inverse);

/* Secondary */
--btn-secondary-bg:       var(--color-brand-subtle);
--btn-secondary-bg-hover: var(--color-blue-100);
--btn-secondary-text:     var(--color-brand);

/* Ghost */
--btn-ghost-bg:           transparent;
--btn-ghost-bg-hover:     var(--color-gray-100);
--btn-ghost-text:         var(--color-text-primary);

/* Danger */
--btn-danger-bg:          var(--color-error);
--btn-danger-bg-hover:    var(--color-red-600);
--btn-danger-text:        var(--color-text-inverse);

/* 공통 */
--btn-height-sm:          2rem;      /* 32px */
--btn-height-md:          2.5rem;    /* 40px */
--btn-height-lg:          3rem;      /* 48px */
--btn-padding-sm:         0 var(--space-3);
--btn-padding-md:         0 var(--space-4);
--btn-padding-lg:         0 var(--space-5);
--btn-radius:             var(--radius-sm);
--btn-font-weight:        var(--font-weight-semibold);
```

---

### Card

```css
--card-bg:                var(--color-bg-surface);
--card-border:            var(--color-border-default);
--card-radius:            var(--radius-md);
--card-shadow:            var(--shadow-xs);
--card-shadow-hover:      var(--shadow-sm);
--card-padding:           var(--spacing-card-md);
--card-padding-lg:        var(--spacing-card-lg);
```

---

### Input / Form

```css
--input-bg:               var(--color-bg-sunken);
--input-bg-focus:         var(--color-bg-surface);
--input-border:           var(--color-border-default);
--input-border-hover:     var(--color-border-strong);
--input-border-focus:     var(--color-border-focus);
--input-border-error:     var(--color-border-error);
--input-text:             var(--color-text-primary);
--input-placeholder:      var(--color-text-tertiary);
--input-radius:           var(--radius-xs);
--input-height:           2.75rem;   /* 44px — 모바일 터치 최적 */
--input-padding-x:        var(--space-3);

--label-color:            var(--color-text-secondary);
--label-font-size:        var(--font-size-sm);
--label-font-weight:      var(--font-weight-medium);
```

---

### 수치 표시 (Numeric Display)

```css
/* 수익률, 등락률 */
--numeric-up-color:       var(--color-stock-up);
--numeric-up-bg:          var(--color-stock-up-bg);
--numeric-down-color:     var(--color-stock-down);
--numeric-down-bg:        var(--color-stock-down-bg);
--numeric-flat-color:     var(--color-stock-flat);
--numeric-flat-bg:        var(--color-stock-flat-bg);

/* 큰 수치 (포트폴리오 총자산 등) */
--display-number-size:    var(--font-size-4xl);
--display-number-weight:  var(--font-weight-extrabold);
--display-number-spacing: var(--letter-spacing-tight);
```

---

### Header / Navigation

```css
--header-bg:              var(--color-bg-surface);
--header-border:          var(--color-border-default);
--header-height:          3.5rem;   /* 56px */
--header-z:               var(--z-sticky);

--nav-item-text:          var(--color-text-secondary);
--nav-item-text-active:   var(--color-text-primary);
--nav-item-bg-hover:      var(--color-gray-50);
--nav-item-bg-active:     var(--color-gray-100);
--nav-item-indicator:     var(--color-brand);  /* active 밑줄 또는 점 */
```

---

### Badge / Tag

```css
/* 신호 강도, 상태 배지 */
--badge-radius:           var(--radius-full);
--badge-padding:          0.2rem 0.6rem;
--badge-font-size:        var(--font-size-xs);
--badge-font-weight:      var(--font-weight-semibold);

/* 색상은 stock 토큰 또는 feedback 토큰 재사용 */
```

---

### Skeleton Loader

```css
--skeleton-base:          var(--color-gray-200);
--skeleton-highlight:     var(--color-gray-100);
--skeleton-radius:        var(--radius-xs);
--skeleton-duration:      1.4s;
```

---

## 11. 다크모드 고려사항

> **현재 상태**: 다크모드 미구현. 향후 도입 시 아래 구조를 따른다.

```css
/* Light (기본) */
:root {
  --color-bg-page:    var(--color-gray-100);
  --color-bg-surface: var(--color-gray-0);
  --color-text-primary: var(--color-gray-900);
  /* ... */
}

/* Dark */
[data-theme="dark"] {
  --color-bg-page:    var(--color-gray-950);
  --color-bg-surface: var(--color-gray-900);
  --color-text-primary: var(--color-gray-50);
  /* ... */
  
  /* 주식 색상은 다크모드에서 밝기 조정 */
  --color-stock-up:   #FF6B78;   /* 다크에서 더 밝게 */
  --color-stock-down: #4D9FFF;
}

/* 시스템 설정 따르기 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* 위 dark 값 동일 적용 */
  }
}
```

---

## 12. 토큰 변경 프로세스

### 토큰 추가할 때

1. Primitive 팔레트에 원시값 추가 (필요한 경우)
2. Semantic 토큰에 의미를 부여
3. 이 문서에 기록 (`docs/design-tokens.md`)
4. `tokens.css`에 반영
5. PR 설명에 "디자인 토큰 변경" 명시

### 기존 토큰 수정할 때

1. 영향 범위 파악: 어떤 컴포넌트가 해당 토큰을 참조하는지 확인
2. 이 문서에서 먼저 수정
3. `tokens.css` 업데이트
4. 시각적 회귀 확인 (변경 전/후 스크린샷)

### 네이밍 규칙

```
--{카테고리}-{역할}-{변형}

예:
--color-bg-surface        ✅
--color-surface-bg        ❌ (카테고리 순서 지켜야)
--bg-surface-color        ❌
--button-primary-bg       ✅ (컴포넌트 토큰)
--btn-primary-background  ❌ (축약어 일관성)
```

### 파일 관리

| 파일 | 역할 |
|------|------|
| `docs/design-tokens.md` | 이 문서 — 의사결정 기록, 사용 가이드 |
| `web/src/styles/tokens.css` | CSS 커스텀 프로퍼티 구현체 |
| `web/tailwind.config.cjs` | Tailwind 테마 확장 (토큰과 동기화) |

---

## 변경 이력

| 날짜 | 버전 | 내용 |
|------|------|------|
| 2026-05-01 | v0.1 | 초안 작성. 색상·타이포·간격·반경·그림자·모션·z-index·브레이크포인트 토큰 정의 |
