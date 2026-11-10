import type { CanvasCard, CanvasCamera } from '../../src/shared';

interface Bitmap { readonly bytes: Uint8Array; readonly width: number; readonly height: number }

/** 只在诊断已结束后读取合成图。下段位于48.9px起，取50–70px避开首行。 */
export function readVisibleIdentityPixels(before: Bitmap, after: Bitmap, cards: readonly CanvasCard[], camera: CanvasCamera, dpr: number) {
  if (before.width !== after.width || before.height !== after.height) throw new Error('identity_control_image_dimensions_changed');
  const band = (card: CanvasCard, top: number, bottom: number) => {
    const rect = { x: Math.ceil((camera.x + (card.x + 18) * camera.zoom) * dpr),
      y: Math.ceil((camera.y + (card.y + top) * camera.zoom) * dpr),
      right: Math.floor((camera.x + (card.x + card.width - 18) * camera.zoom) * dpr),
      bottom: Math.floor((camera.y + (card.y + bottom) * camera.zoom) * dpr) };
    let changed = 0, maximumDelta = 0;
    for (let y = rect.y; y < rect.bottom; y++) for (let x = rect.x; x < rect.right; x++) {
      if (x < 0 || y < 0 || x >= before.width || y >= before.height) throw new Error('identity_control_paragraph_outside_capture');
      const index = (y * before.width + x) * 4;
      const delta = Math.max(...[0, 1, 2].map(channel => Math.abs(before.bytes[index + channel] - after.bytes[index + channel])));
      if (delta) changed++; maximumDelta = Math.max(maximumDelta, delta);
    }
    return { rect, changed, maximumDelta };
  };
  return cards.map(card => ({ id: card.id, first: band(card, 18, 38), second: band(card, 50, 70) }));
}
