import { readCanvasElementText } from '@plugin/canvas/shared';
import { CANVAS_CLIPBOARD_MIME, CanvasClipboardSchema } from '../definitions/canvasClipboard';
import type { CanvasClipboardPort } from '../definitions/canvasClipboardPort';

export function installCanvasClipboard(host: HTMLElement, port: CanvasClipboardPort): () => void {
  const copy = (event: ClipboardEvent) => {
    if (!port.canHandle() || !event.clipboardData) return;
    const elements = port.read();
    if (!elements.length) return;
    event.preventDefault();
    event.clipboardData.setData(CANVAS_CLIPBOARD_MIME, JSON.stringify({ version: 1, elements }));
    event.clipboardData.setData('text/plain', elements.filter(element => element.type !== 'edge').map(element => element.type === 'document' ? '文档' : readCanvasElementText(element)).join('\n\n'));
    if (event.type === 'cut') void port.cut().catch(port.fail);
  };
  const paste = (event: ClipboardEvent) => {
    if (!port.canHandle() || !event.clipboardData) return;
    const raw = event.clipboardData.getData(CANVAS_CLIPBOARD_MIME), text = event.clipboardData.getData('text/plain');
    if (!raw && !text) return;
    event.preventDefault();
    try {
      const run = raw ? port.pasteElements(CanvasClipboardSchema.parse(JSON.parse(raw)).elements) : port.pasteText(text);
      void run.catch(port.fail);
    } catch (error) { port.fail(error); }
  };
  host.addEventListener('copy', copy); host.addEventListener('cut', copy); host.addEventListener('paste', paste);
  return () => { host.removeEventListener('copy', copy); host.removeEventListener('cut', copy); host.removeEventListener('paste', paste); };
}
