/**
 * 거래내역 캡처를 브라우저 안에서 줄 단위로 읽는다(Tesseract.js, 무료·이미지를 서버로 보내지 않음).
 * 거래 목록은 가맹점과 금액이 같은 줄에 있어 한 장을 한 덩어리로 읽는 것이 줄 구조를 가장 잘 지킨다.
 * (주문내역처럼 칸마다 따로 읽는 방식은 구분선·여백에 줄 자르기가 흔들려 거래 목록에는 쓰지 않는다)
 */
import { crop, loadGray, type OcrWorker } from '../../lib/ocrCanvas'

export async function ocrSpendCapture(files: File[], onStatus: (message: string) => void): Promise<string> {
  const { createWorker, PSM } = await import('tesseract.js')
  onStatus('글자 인식 준비 중… (처음에는 한글 데이터를 내려받아 조금 걸립니다)')
  const worker = (await createWorker('kor+eng', 1)) as unknown as OcrWorker
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
    const texts: string[] = []
    for (let i = 0; i < files.length; i++) {
      onStatus(`${i + 1}/${files.length}번째 캡처 읽는 중…`)
      const g = await loadGray(files[i])
      const { data } = await worker.recognize(crop(g, 0, 0, g.width, g.height))
      texts.push(data.text)
    }
    return texts.join('\n')
  } finally {
    await worker.terminate()
  }
}
