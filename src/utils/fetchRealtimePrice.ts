// src/utils/fetchRealtimePrice.ts

// 1. 네이버 API 응답 형식을 정의합니다.
interface NaverStockResponse {
  closePrice: string; // "6,030" 처럼 문자열로 옴
  compareToPreviousClosePrice: string;
  fluctuationsRatio: string;
  // 필요한 필드가 더 있다면 여기에 추가
}

export async function fetchRealtimePrice(code: string): Promise<number | null> {
  try {
    // 네이버 모바일 증권 페이지가 가볍고 파싱하기 쉬움
    const response = await fetch(
      `https://m.stock.naver.com/api/stock/${code}/basic`
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // 2. 여기서 'as NaverStockResponse'로 타입을 강제합니다.
    //    (response.json()은 기본적으로 any 또는 unknown을 반환하므로)
    const data = (await response.json()) as NaverStockResponse;

    // 3. 이제 TS가 data.closePrice를 인식합니다.
    if (data && data.closePrice) {
      return parseInt(data.closePrice.replace(/,/g, ""), 10);
    }

    return null;
  } catch (e) {
    console.error(`실시간 가격 조회 실패 (${code}):`, e);
    return null;
  }
}
