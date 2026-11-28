export interface PixelBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 外接框的长边不到整张图长边 2% 的连通块当作碎屑（压缩噪点、杂点）丢掉。
 * 按外接框而不按像素数判：剑、钥匙这类细长图标实际像素很少，按像素数会被误当成碎屑。
 */
const MIN_PIECE_SIDE = 0.02;
/** 相距两格（缩小后的像素）以内的笔画并成一块：一个元素常由几笔不相连的部分组成，例如字的偏旁、飞鸟的翅膀。 */
const JOIN_RADIUS = 2;
/**
 * 长边不到中位块三分之一的算碎片（水花溅出的水滴、烟雾、气泡），离某个大块不到它长边 15% 时并进去；
 * 离得远的仍单独成块。图标表里各块大小相近，不会触发。
 */
const FRAGMENT_RATIO = 1 / 3;
const FRAGMENT_REACH = 0.15;
/** 透明度过半才算元素的一部分。 */
const SOLID_ALPHA = 128;
/** 找连通块时四周多留几像素，免得柔边被切掉；最后还会收紧到不透明的范围。 */
const PIECE_PADDING = 4;

/** 按列 × 行等分。 */
export function gridPieceBoxes(width: number, height: number, columns: number, rows: number): PixelBox[] {
  const boxes: PixelBox[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = Math.round((column * width) / columns);
      const top = Math.round((row * height) / rows);
      boxes.push({
        left, top,
        width: Math.round(((column + 1) * width) / columns) - left,
        height: Math.round(((row + 1) * height) / rows) - top,
      });
    }
  }
  return boxes;
}

function longSide(box: PixelBox): number {
  return Math.max(box.width, box.height);
}

function gapBetween(a: PixelBox, b: PixelBox): number {
  const dx = Math.max(0, a.left - (b.left + b.width), b.left - (a.left + a.width));
  const dy = Math.max(0, a.top - (b.top + b.height), b.top - (a.top + a.height));
  return Math.hypot(dx, dy);
}

function union(a: PixelBox, b: PixelBox): PixelBox {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return {
    left, top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
}

/** 碎片并进最近的大块；够不着任何大块的碎片保留为单独一块。 */
function absorbFragments(boxes: readonly PixelBox[]): PixelBox[] {
  if (boxes.length < 2) return [...boxes];
  const sides = boxes.map(longSide).sort((a, b) => a - b);
  const median = sides[sides.length >> 1];
  const isFragment = (box: PixelBox) => longSide(box) < median * FRAGMENT_RATIO;
  const large = boxes.filter(box => !isFragment(box));
  const merged = [...large];
  const kept: PixelBox[] = [];
  for (const fragment of boxes.filter(isFragment)) {
    let nearest = -1;
    let nearestGap = Infinity;
    for (const [index, box] of large.entries()) {
      const gap = gapBetween(fragment, box);
      if (gap <= longSide(box) * FRAGMENT_REACH && gap < nearestGap) {
        nearest = index;
        nearestGap = gap;
      }
    }
    if (nearest < 0) kept.push(fragment);
    else merged[nearest] = union(merged[nearest], fragment);
  }
  return [...merged, ...kept];
}

/**
 * 宫格的阅读顺序：先按纵向中心分行（与本行第一块的中心相差不到半个块高算同一行），行内从左到右。
 * 不用带容差的比较函数直接排序：那样不满足传递性，结果会随输入顺序变。
 */
function readingOrder(boxes: readonly PixelBox[]): PixelBox[] {
  const centerX = (box: PixelBox) => box.left + box.width / 2;
  const centerY = (box: PixelBox) => box.top + box.height / 2;
  const rows: PixelBox[][] = [];
  for (const box of [...boxes].sort((a, b) => centerY(a) - centerY(b))) {
    const row = rows[rows.length - 1];
    const first = row?.[0];
    if (row && first && centerY(box) - centerY(first) < Math.min(first.height, box.height) / 2) row.push(box);
    else rows.push([box]);
  }
  return rows.flatMap(row => row.sort((a, b) => centerX(a) - centerX(b)));
}

/**
 * 在缩小后的透明度图上找连通块，换算回原图坐标，碎片并进旁边的元素，按阅读顺序返回。
 * `scale` 是缩小图相对原图的比例。
 */
export function connectedPieceBoxes(
  alpha: Uint8Array, smallWidth: number, smallHeight: number, scale: number, width: number, height: number,
): PixelBox[] {
  const seen = new Uint8Array(smallWidth * smallHeight);
  const found: PixelBox[] = [];
  const stack: number[] = [];
  const minSide = Math.max(smallWidth, smallHeight) * MIN_PIECE_SIDE;
  for (let start = 0; start < alpha.length; start += 1) {
    if (seen[start] || alpha[start] < SOLID_ALPHA) continue;
    let minX = smallWidth;
    let minY = smallHeight;
    let maxX = 0;
    let maxY = 0;
    seen[start] = 1;
    stack.push(start);
    for (let i = stack.pop(); i !== undefined; i = stack.pop()) {
      const x = i % smallWidth;
      const y = (i - x) / smallWidth;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -JOIN_RADIUS; dy <= JOIN_RADIUS; dy += 1) {
        for (let dx = -JOIN_RADIUS; dx <= JOIN_RADIUS; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= smallWidth || ny >= smallHeight) continue;
          const k = ny * smallWidth + nx;
          if (!seen[k] && alpha[k] >= SOLID_ALPHA) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
    }
    if (Math.max(maxX - minX + 1, maxY - minY + 1) < minSide) continue;
    const left = Math.max(0, Math.floor(minX / scale) - PIECE_PADDING);
    const top = Math.max(0, Math.floor(minY / scale) - PIECE_PADDING);
    const right = Math.min(width, Math.ceil((maxX + 1) / scale) + PIECE_PADDING);
    const bottom = Math.min(height, Math.ceil((maxY + 1) / scale) + PIECE_PADDING);
    found.push({ left, top, width: right - left, height: bottom - top });
  }
  return readingOrder(absorbFragments(found));
}
