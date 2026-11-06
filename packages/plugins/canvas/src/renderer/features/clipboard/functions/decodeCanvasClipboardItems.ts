import {
  CANVAS_CLIPBOARD_MIME,
  CanvasClipboardSchema,
  type CanvasClipboardPayload,
} from '../definitions/canvasClipboard';
export async function decodeCanvasClipboardItems(
  items: readonly ClipboardItem[]
): Promise<CanvasClipboardPayload> {
  const mime = `web ${CANVAS_CLIPBOARD_MIME}`,
    rich = items.find(item => item.types.includes(mime));
  if (rich)
    return {
      kind: 'elements',
      elements: CanvasClipboardSchema.parse(JSON.parse(await (await rich.getType(mime)).text()))
        .elements,
    };
  const files: File[] = [];
  for (const item of items) {
    const type = item.types.find(type => type.startsWith('image/'));
    if (type) files.push(new File([await item.getType(type)], '粘贴图片', { type }));
  }
  if (files.length) return { kind: 'images', files };
  const text = items.find(item => item.types.includes('text/plain'));
  return text
    ? { kind: 'text', text: await (await text.getType('text/plain')).text() }
    : { kind: 'empty' };
}
