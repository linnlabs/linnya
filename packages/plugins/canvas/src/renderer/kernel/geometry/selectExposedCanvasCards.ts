import type { CanvasCamera, CanvasCard } from '../../../shared';

/** 只淘汰被上层不透明纸面完全覆盖的卡；16px网格只记完全覆盖单元，不能漏掉露出的正文。 */
export function selectExposedCanvasCards(cards: readonly CanvasCard[], camera: CanvasCamera, width: number, height: number): readonly CanvasCard[] {
  const cell = 16, columns = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  const covered = new Uint8Array(columns * rows);
  const exposed: CanvasCard[] = [];
  for (let index = cards.length - 1; index >= 0; index--) {
    const card = cards[index];
    const left = Math.max(0, card.x * camera.zoom + camera.x), top = Math.max(0, card.y * camera.zoom + camera.y);
    const right = Math.min(width, (card.x + card.width) * camera.zoom + camera.x), bottom = Math.min(height, (card.y + card.height) * camera.zoom + camera.y);
    if (right <= left || bottom <= top) continue;
    const firstColumn = Math.floor(left / cell), lastColumn = Math.ceil(right / cell);
    const firstRow = Math.floor(top / cell), lastRow = Math.ceil(bottom / cell);
    let visible = false;
    for (let y = firstRow; y < lastRow && !visible; y++) for (let x = firstColumn; x < lastColumn; x++) {
      if (!covered[y * columns + x]) { visible = true; break; }
    }
    if (visible) exposed.push(card);
    // 九宫格有圆角和阴影，只用内缩6世界单位后的实体纸面建立遮挡事实。
    const inset = 6 * camera.zoom;
    const coverLeft = Math.max(0, card.x * camera.zoom + camera.x + inset), coverTop = Math.max(0, card.y * camera.zoom + camera.y + inset);
    const coverRight = Math.min(width, (card.x + card.width) * camera.zoom + camera.x - inset), coverBottom = Math.min(height, (card.y + card.height) * camera.zoom + camera.y - inset);
    for (let y = Math.ceil(coverTop / cell); y < Math.floor(coverBottom / cell); y++) {
      for (let x = Math.ceil(coverLeft / cell); x < Math.floor(coverRight / cell); x++) covered[y * columns + x] = 1;
    }
  }
  return exposed.reverse();
}
