import { describe, expect, it } from 'vitest';
import type { Context } from 'konva/lib/Context';
import type { ImageRenderNode } from '../../../../../types/render';
import { INCHES_TO_PX } from '../../../../../shared/constants';
import type { LoadedRenderImage } from '../../../../renderImageResources';
import {
  buildImageGroupConfig,
  buildImageNodeConfig,
  buildImagePlaceholderConfig,
  buildMaskedImageShapeConfig,
  resolveRenderImageMask,
} from '../imageBuilder';

function createImageNode(overrides: Partial<ImageRenderNode> = {}): ImageRenderNode {
  return {
    id: 'image-1',
    kind: 'image',
    box: { x: 1, y: 1, w: 4, h: 2, unit: 'in' },
    zIndex: 1,
    assetRef: { type: 'external', url: '' },
    ...overrides,
  };
}

function loaded(naturalWidth: number, naturalHeight: number): LoadedRenderImage {
  return { image: {} as HTMLImageElement, naturalWidth, naturalHeight };
}

/** 只记录路径调用的假 Context，用来核对遮罩描出的轮廓。 */
function recordPath() {
  const calls: string[] = [];
  const record = (name: string) => (...args: number[]) => {
    calls.push(`${name}(${args.map((value) => Math.round(value * 10) / 10).join(',')})`);
  };
  const context = {
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arcTo: record('arcTo'),
    rect: record('rect'),
    ellipse: record('ellipse'),
    quadraticCurveTo: record('quadraticCurveTo'),
    bezierCurveTo: record('bezierCurveTo'),
    fillStrokeShape: () => calls.push('fillStrokeShape'),
  } as unknown as Context;
  return { calls, context };
}

const SHADOW = { color: '#000000', blur: 6, offsetX: 2, offsetY: 3 };

describe('imageBuilder 遮罩与阴影', () => {
  it('没有遮罩时不裁剪：阴影跟着图片透明通道走（去背 PNG 不再只剩盒内一截）', () => {
    const node = createImageNode({ shadow: SHADOW });

    expect(buildImageGroupConfig(node)).not.toHaveProperty('clipFunc');
    expect(resolveRenderImageMask(node)).toBeUndefined();
    expect(buildImageNodeConfig(node, loaded(400, 200))).toMatchObject({
      shadowEnabled: true,
      shadowOpacity: 0.3,
    });
  });

  it('圆角矩形仍用 clipFunc；rect 遮罩不算遮罩', () => {
    expect(buildImageGroupConfig(createImageNode({ borderRadius: 8 }))).toHaveProperty('clipFunc');
    expect(resolveRenderImageMask(createImageNode({ maskShape: 'rect' }))).toBeUndefined();
    expect(buildImagePlaceholderConfig(createImageNode({ borderRadius: 8 })).cornerRadius).toBe(8);
  });

  it('形状遮罩套在 contain 之后的实际画面框上，图案正好铺满画面，阴影交给形状', () => {
    const node = createImageNode({
      fitMode: 'contain',
      maskShape: { type: 'preset', name: 'hexagon' },
      shadow: { ...SHADOW, opacity: 0.5 },
    });
    const mask = resolveRenderImageMask(node);
    expect(mask).toEqual({ type: 'preset', name: 'hexagon' });

    // 1:1 原图放进 4×2 的盒子：画面框是居中的 2×2。
    const config = buildMaskedImageShapeConfig(node, mask!, loaded(100, 100));
    const side = 2 * INCHES_TO_PX;
    expect(config).toMatchObject({
      x: INCHES_TO_PX,
      y: 0,
      width: side,
      height: side,
      fillPatternRepeat: 'no-repeat',
      fillPatternX: 0,
      fillPatternScaleX: side / 100,
      fillPatternScaleY: side / 100,
      shadowOpacity: 0.5,
      shadowOffsetY: expect.any(Number),
    });
  });

  it('cover 裁剪与水平翻转映射到图案的偏移和负缩放，路径坐标同步镜像', () => {
    const node = createImageNode({
      fitMode: 'cover',
      flipH: true,
      maskShape: {
        type: 'path',
        viewBox: { width: 10, height: 10 },
        commands: [
          { type: 'moveTo', x: 0, y: 0 },
          { type: 'lineTo', x: 10, y: 0 },
          { type: 'lineTo', x: 0, y: 10 },
          { type: 'close' },
        ],
      },
    });
    const width = 4 * INCHES_TO_PX;
    const height = 2 * INCHES_TO_PX;
    // 1:1 原图放进 2:1 盒子：cover 取原图中间的 100×50。
    const config = buildMaskedImageShapeConfig(node, resolveRenderImageMask(node)!, loaded(100, 100));
    expect(config).toMatchObject({ x: 0, y: 0, width, height, fillPatternX: width, fillPatternOffsetY: 25 });
    expect(config.fillPatternScaleX).toBeCloseTo(-width / 100);
    expect(config.fillPatternScaleY).toBeCloseTo(height / 50);

    const { calls, context } = recordPath();
    config.sceneFunc(context, {} as Parameters<typeof config.sceneFunc>[1]);
    expect(calls).toEqual([
      'beginPath()',
      `moveTo(${Math.round(width * 10) / 10},0)`,
      'lineTo(0,0)',
      `lineTo(${Math.round(width * 10) / 10},${Math.round(height * 10) / 10})`,
      'closePath()',
      'fillStrokeShape',
    ]);
  });

  it('图片还没加载时，遮罩形状用占位色填，轮廓不变', () => {
    const node = createImageNode({ maskShape: 'circle' });
    const config = buildMaskedImageShapeConfig(node, resolveRenderImageMask(node)!, null);
    expect(config).not.toHaveProperty('fillPatternImage');
    expect(config).toHaveProperty('fill');

    const { calls, context } = recordPath();
    config.sceneFunc(context, {} as Parameters<typeof config.sceneFunc>[1]);
    expect(calls[1]).toMatch(/^ellipse\(/);
  });

  it('roundRect 遮罩用圆弧角，与 PowerPoint roundRect 一致', () => {
    const node = createImageNode({ maskShape: { type: 'preset', name: 'roundRect' } });
    const config = buildMaskedImageShapeConfig(node, resolveRenderImageMask(node)!, loaded(400, 200));
    const { calls, context } = recordPath();
    config.sceneFunc(context, {} as Parameters<typeof config.sceneFunc>[1]);
    expect(calls.filter((call) => call.startsWith('arcTo'))).toHaveLength(4);
  });
});
