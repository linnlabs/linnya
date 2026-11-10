import { canvasRectanglesOverlap, type CanvasRectangle } from '../../../shared';
import type { CanvasMapLabelCollisionIndex } from '../definitions/canvasMapLabels';

/** 屏幕格只缩小候选集合，是否避让由真实单行排版框决定；优先序由调用方保留。 */
export function createCanvasMapLabelCollisionIndex(): CanvasMapLabelCollisionIndex {
  const cells = new Map<string, CanvasRectangle[]>();
  const visit = (bounds: CanvasRectangle, matches: (other: CanvasRectangle) => boolean) => {
    const right = Math.floor((bounds.x + bounds.width) / 150),
      bottom = Math.floor((bounds.y + bounds.height) / 24);
    for (let y = Math.floor(bounds.y / 24); y <= bottom; y++)
      for (let x = Math.floor(bounds.x / 150); x <= right; x++) {
        if (cells.get(`${x}:${y}`)?.some(matches)) return true;
      }
    return false;
  };
  return {
    blocksAnchor(x, y, lineHeight) {
      // 候选从anchor向右排。左边缘已落在旧框横向内部且行高相交时，任何非空宽度都会碰撞。
      // 在读标题/测宽之前排除密集重复位置，不能先为12k被挡标题反复measureText。
      return visit(
        { x, y, width: 0, height: lineHeight },
        other =>
          other.x <= x &&
          x < other.x + other.width &&
          other.y < y + lineHeight &&
          other.y + other.height > y
      );
    },
    intersects(bounds) {
      return visit(bounds, other => canvasRectanglesOverlap(bounds, other));
    },
    insert(bounds) {
      const right = Math.floor((bounds.x + bounds.width) / 150),
        bottom = Math.floor((bounds.y + bounds.height) / 24);
      for (let y = Math.floor(bounds.y / 24); y <= bottom; y++)
        for (let x = Math.floor(bounds.x / 150); x <= right; x++) {
          const key = `${x}:${y}`,
            bucket = cells.get(key);
          if (bucket) bucket.push(bounds);
          else cells.set(key, [bounds]);
        }
    },
  };
}
