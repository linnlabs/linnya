import { describe, expect, it } from 'vitest';
import { isPdfOcrPageLimitMessage } from './pdfOcrPageLimitPresentation';

describe('isPdfOcrPageLimitMessage', () => {
  it('识别 PDF OCR 页数上限错误，用于触发用户通知', () => {
    expect(isPdfOcrPageLimitMessage(
      'PDF "scan.pdf" 共 101 页，当前 OCR 模型 PaddleOCR-VL-1.6 单次最多解析 100 页。为避免上游忽略超出页，请先拆分后上传。'
    )).toBe(true);

    expect(isPdfOcrPageLimitMessage('上传失败')).toBe(false);
  });
});
