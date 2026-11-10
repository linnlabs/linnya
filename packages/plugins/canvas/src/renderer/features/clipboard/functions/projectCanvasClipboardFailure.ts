import { canvasText } from '../../localization';

/** 剪贴板接口和解码抛出的是浏览器英文原文或校验明细，不能直接给用户看。 */
export function projectCanvasPasteFailure(error: unknown): unknown {
  if (error instanceof DOMException && error.name === 'AbortError') return error;
  return new Error(
    canvasText(
      error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'canvas.input.paste.denied'
        : 'canvas.input.paste.unsupported'
    )
  );
}

/** 写入时 prepare 的产品失败原样保留，只翻译浏览器自己的拒绝。 */
export function projectCanvasCopyFailure(error: unknown): unknown {
  if (!(error instanceof DOMException) || error.name === 'AbortError') return error;
  return new Error(
    canvasText(
      error.name === 'NotAllowedError' ? 'canvas.input.copy.denied' : 'canvas.input.copy.failed'
    )
  );
}
