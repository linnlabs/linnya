const cache = new Map<string, { readonly source: string; readonly bytes: number }>();
const pending = new Map<string, { readonly input: string; readonly result: Promise<string> }>();
let cachedBytes = 0, generation = 0, decoding: Promise<void> = Promise.resolve();
const budget = 32 * 1024 * 1024;
function imageBlob(source: string): Blob {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(source);
  if (!match?.[1] || !match[2]) throw new Error('resource_unavailable');
  const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
}
function dataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { if (typeof reader.result === 'string') resolve(reader.result); else reject(new Error('image_display_encode_failed')); }; reader.onerror = () => reject(reader.error ?? new Error('image_display_encode_failed')); reader.readAsDataURL(blob); });
}
function remember(key: string, source: string): void {
  const bytes = source.length * 2; if (bytes > budget) return;
  while (cache.size && cachedBytes + bytes > budget) { const oldest = cache.entries().next().value; if (!oldest) break; cache.delete(oldest[0]); cachedBytes -= oldest[1].bytes; }
  cache.set(key, { source, bytes }); cachedBytes += bytes;
}
async function prepare(assetId: string, source: string, token: number): Promise<string> {
  if (token !== generation) throw new DOMException('Canvas image preparation disposed', 'AbortError');
  const blob = imageBlob(source), digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''), key = `${assetId}:${hash}`;
  const cached = cache.get(key); if (cached) { cache.delete(key); cache.set(key, cached); return cached.source; }
  const original = await createImageBitmap(blob); let resized: ImageBitmap | null = null;
  try {
    if (Math.max(original.width, original.height) <= 2048) { if (token === generation) remember(key, source); return source; }
    const ratio = 2048 / Math.max(original.width, original.height), width = Math.max(1, Math.round(original.width * ratio)), height = Math.max(1, Math.round(original.height * ratio));
    resized = await createImageBitmap(original, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
    if (!context) throw new Error('image_display_context_unavailable');
    context.drawImage(resized, 0, 0); const result = await dataUri(await canvas.convertToBlob({ type: 'image/png' }));
    if (token === generation) remember(key, result); return result;
  } finally { resized?.close(); original.close(); }
}
function display(assetId: string, source: string): Promise<string> {
  const current = pending.get(assetId); if (current?.input === source) return current.result;
  const token = generation;
  // 同时解码多张大图会绕过纹理预算；每次只持有一张原图bitmap，且从未先挂入DOM。
  const result = decoding.then(() => prepare(assetId, source, token));
  decoding = result.then(() => undefined, () => undefined);
  const settled = result.finally(() => { if (pending.get(assetId)?.result === settled) pending.delete(assetId); });
  pending.set(assetId, { input: source, result: settled }); return settled;
}
/** 前台与隐藏worker共用。返回只读显示源，原资产与正文身份不发生变化。 */
export async function resolveCanvasDisplayImages(assets: Readonly<Record<string, string>>, signal: AbortSignal): Promise<Readonly<Record<string, string>>> {
  const result: Record<string, string> = {};
  for (const [assetId, source] of Object.entries(assets)) { signal.throwIfAborted(); result[assetId] = await display(assetId, source); }
  signal.throwIfAborted(); return result;
}
export function clearCanvasDisplayImageCache(): void { generation++; cache.clear(); cachedBytes = 0; }
