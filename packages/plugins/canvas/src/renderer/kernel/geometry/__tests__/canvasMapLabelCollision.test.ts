import { expect, it } from 'vitest';
import { createCanvasMapLabelCollisionIndex } from '../canvasMapLabelCollision';

it('同格不相交标签都保留；跨格的真实相交仍避让，贴边不算重叠', () => {
  const index = createCanvasMapLabelCollisionIndex();
  index.insert({ x: 160, y: 10, width: 20, height: 16 });
  expect(index.intersects({ x: 190, y: 10, width: 20, height: 16 })).toBe(false);
  // 候选左边缘尚未被遮住，但向右伸入相邻格的优先标签，仍须精确矩形检查。
  expect(index.blocksAnchor(140, 10, 16)).toBe(false);
  expect(index.intersects({ x: 140, y: 10, width: 40, height: 16 })).toBe(true);
  expect(index.blocksAnchor(180, 10, 16)).toBe(false);
  expect(index.intersects({ x: 180, y: 10, width: 20, height: 16 })).toBe(false);
  expect(index.blocksAnchor(160, 26, 16)).toBe(false);
  expect(index.intersects({ x: 160, y: 26, width: 20, height: 16 })).toBe(false);
  expect(index.blocksAnchor(160, -5, 16)).toBe(true);
  expect(index.blocksAnchor(160, -6, 16)).toBe(false);
});

it('负坐标与横纵跨格标签保持同一碰撞规则，查询只需相邻候选格', () => {
  const index = createCanvasMapLabelCollisionIndex();
  index.insert({ x: -10, y: -8, width: 40, height: 16 });
  expect(index.blocksAnchor(0, 0, 16)).toBe(true);
  expect(index.intersects({ x: -30, y: -16, width: 21, height: 12 })).toBe(true);
  expect(index.intersects({ x: 30, y: -8, width: 40, height: 16 })).toBe(false);
  expect(index.intersects({ x: -10, y: 8, width: 40, height: 16 })).toBe(false);
});
