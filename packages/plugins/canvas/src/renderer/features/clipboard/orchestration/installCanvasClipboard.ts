import { CANVAS_CLIPBOARD_MIME } from '../definitions/canvasClipboard';
import type { CanvasClipboardPort } from '../definitions/canvasClipboardPort';
import { canvasText } from '../../localization';
import { decodeCanvasClipboardItems } from '../functions/decodeCanvasClipboardItems';
import {
  projectCanvasCopyFailure,
  projectCanvasPasteFailure,
} from '../functions/projectCanvasClipboardFailure';
const webMime = `web ${CANVAS_CLIPBOARD_MIME}`;
/** Chromium正式web custom format同时保留子图与Markdown；Promise表示同一冻结快照。 */
export function installCanvasClipboard(host: HTMLElement, port: CanvasClipboardPort) {
  let disposed = false;
  const copy = async (cut = false) => {
    if (!port.canHandle() || disposed) return;
    if (cut && !port.canWrite()) throw new Error(canvasText('canvas.input.cut.readonly'));
    const source = port.read();
    if (!source.length) return;
    const prepared = port.prepare(source.map(element => element.id));
    await navigator.clipboard
      .write([
        new ClipboardItem({
          [webMime]: prepared.then(
            value =>
              new Blob([JSON.stringify({ version: 1, elements: value.elements })], {
                type: CANVAS_CLIPBOARD_MIME,
              })
          ),
          'text/plain': prepared.then(value => new Blob([value.text], { type: 'text/plain' })),
        }),
      ])
      .catch((error: unknown) => {
        throw projectCanvasCopyFailure(error);
      });
    // 剪切只删除已经复制的那份修订，不在await后重新读取选择或删掉Agent的新内容。
    if (cut && !disposed && port.canHandle()) {
      if (!port.canWrite()) throw new Error(canvasText('canvas.input.cut.readonlyAfterCopy'));
      await port.cut((await prepared).elements);
    }
  };
  const paste = async () => {
    if (!port.canHandle() || disposed) return;
    if (!port.canWrite()) throw new Error(canvasText('canvas.input.paste.readonly'));
    const point = port.pastePoint();
    const payload = await navigator.clipboard
      .read()
      .then(decodeCanvasClipboardItems)
      .catch((error: unknown) => {
        throw projectCanvasPasteFailure(error);
      });
    if (disposed || !port.canHandle() || !port.canWrite()) return;
    switch (payload.kind) {
      case 'elements':
        await port.pasteElements(payload.elements, point);
        return;
      case 'images':
        await port.pasteImages(payload.files, point);
        return;
      case 'text':
        await port.pasteText(payload.text, point);
        return;
      case 'empty':
        return;
    }
  };
  const copyEvent = (event: ClipboardEvent) => {
    if (!port.canHandle() || !port.read().length) return;
    event.preventDefault();
    void copy(event.type === 'cut').catch(port.fail);
  };
  const pasteEvent = (event: ClipboardEvent) => {
    if (!port.canHandle() || event.defaultPrevented) return;
    event.preventDefault();
    void paste().catch(port.fail);
  };
  host.addEventListener('copy', copyEvent);
  host.addEventListener('cut', copyEvent);
  host.addEventListener('paste', pasteEvent);
  return {
    copy: () => copy(),
    cut: () => copy(true),
    paste,
    dispose() {
      disposed = true;
      host.removeEventListener('copy', copyEvent);
      host.removeEventListener('cut', copyEvent);
      host.removeEventListener('paste', pasteEvent);
    },
  };
}
