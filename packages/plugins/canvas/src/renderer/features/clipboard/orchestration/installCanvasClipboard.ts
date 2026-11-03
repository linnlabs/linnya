import { CANVAS_CLIPBOARD_MIME, CanvasClipboardSchema } from '../definitions/canvasClipboard';
import type { CanvasClipboardPort } from '../definitions/canvasClipboardPort';
const webMime = `web ${CANVAS_CLIPBOARD_MIME}`;
/** Chromium正式web custom format同时保留子图与Markdown；Promise表示同一冻结快照。 */
export function installCanvasClipboard(host: HTMLElement, port: CanvasClipboardPort) {
  let disposed = false;
  const copy = async (cut = false) => {
    if (!port.canHandle() || disposed) return;
    const source = port.read(); if (!source.length) return;
    const prepared = port.prepare(source.map(element => element.id));
    await navigator.clipboard.write([new ClipboardItem({
      [webMime]: prepared.then(value => new Blob([JSON.stringify({ version: 1, elements: value.elements })], { type: CANVAS_CLIPBOARD_MIME })),
      'text/plain': prepared.then(value => new Blob([value.text], { type: 'text/plain' })),
    })]);
    // 剪切只删除已经复制的那份修订，不在await后重新读取选择或删掉Agent的新内容。
    if (cut && !disposed && port.canHandle()) await port.cut((await prepared).elements);
  };
  const paste = async () => {
    if (!port.canHandle() || disposed) return;
    const point = port.pastePoint();
    const items = await navigator.clipboard.read();
    if (!port.canHandle() || disposed) return;
    const rich = items.find(item => item.types.includes(webMime));
    if (rich) { const data = CanvasClipboardSchema.parse(JSON.parse(await (await rich.getType(webMime)).text())); if (!disposed && port.canHandle()) await port.pasteElements(data.elements, point); return; }
    const images: File[] = [];
    for (const item of items) { const type = item.types.find(type => type.startsWith('image/')); if (type) images.push(new File([await item.getType(type)], '粘贴图片', { type })); }
    if (images.length) { if (!disposed && port.canHandle()) await port.pasteImages(images, point); return; }
    const textItem = items.find(item => item.types.includes('text/plain'));
    if (textItem) { const text = await (await textItem.getType('text/plain')).text(); if (!disposed && port.canHandle()) await port.pasteText(text, point); }
  };
  const copyEvent = (event: ClipboardEvent) => { if (!port.canHandle() || !port.read().length) return; event.preventDefault(); void copy(event.type === 'cut').catch(port.fail); };
  const pasteEvent = (event: ClipboardEvent) => { if (!port.canHandle() || event.defaultPrevented) return; event.preventDefault(); void paste().catch(port.fail); };
  host.addEventListener('copy', copyEvent); host.addEventListener('cut', copyEvent); host.addEventListener('paste', pasteEvent);
  return { copy: () => copy(), cut: () => copy(true), paste,
    dispose() { disposed = true; host.removeEventListener('copy', copyEvent); host.removeEventListener('cut', copyEvent); host.removeEventListener('paste', pasteEvent); },
  };
}
