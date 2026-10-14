import sharp from 'sharp';
import { invokeHiddenWorker } from '../../../../../src/electron-main/hidden-worker/standaloneHiddenWorkerRuntime';
import { admitSvgGraphic } from '../../src/backend/engine/svgGraphic';
import type { RenderNode } from '../../src/shared';
import { parseSlideRasterResult, type SlideRasterRequest } from '../../src/shared/slideRasterization';

/** 用真实 worker 像素同时验证中心旋转、局部裁剪与图片翻转，不能只比较 builder 字段。 */
export async function assertCenterRotationRenders(): Promise<void> {
  const admitted = admitSvgGraphic('<svg viewBox="0 0 100 50"><rect width="50" height="50" fill="#FF0000"/><rect x="50" width="50" height="50" fill="#0000FF"/></svg>');
  const png = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#FF0000' } })
    .composite([{ input: { create: { width: 50, height: 50, channels: 3, background: '#0000FF' } }, left: 50, top: 0 }])
    .png().toBuffer();
  const visuals: RenderNode[] = [
    ...(['contain', 'stretch'] as const).map(fit => ({
      id: `svg-${fit}`, kind: 'svgGraphic' as const, zIndex: 0,
      box: { x: 1, y: 1, w: 4, h: 4, unit: 'in' as const },
      canonicalSvg: admitted.canonicalSvg, contentHash: admitted.contentHash, viewBox: admitted.viewBox,
      decorative: true, fit,
    })),
    ...[false, true].map(flipH => ({
      id: `image-${flipH}`, kind: 'image' as const, zIndex: 0,
      box: { x: 1, y: 2, w: 4, h: 2, unit: 'in' as const },
      assetRef: { type: 'data' as const, dataUri: `data:image/png;base64,${png.toString('base64')}` },
      fitMode: 'cover' as const, flipH,
    })),
    ...(['rect', 'ellipse'] as const).map(name => ({
      id: name, kind: 'shape' as const, zIndex: 0,
      box: { x: 1, y: 2, w: 4, h: 2, unit: 'in' as const },
      geometry: { type: 'preset' as const, name }, fill: { type: 'solid' as const, color: '#FF0000' },
    })),
  ];
  for (const visual of visuals) {
    for (const rotation of [90, -90]) {
      const request: SlideRasterRequest = {
        requestId: `center-rotation-${visual.id}-${rotation}`,
        slideSize: { width: 6, height: 6, unit: 'in' },
        profile: { id: 'center-rotation-v1', viewportWidthPx: 600, viewportHeightPx: 600, pixelRatio: 1, format: 'png' },
        slide: {
          slideId: 'center-rotation', index: 0, layoutKey: 'freeform',
          background: { paint: { type: 'solid', color: '#FFFFFF' } },
          elements: [{ ...visual, rotation }],
        },
      };
      const raster = parseSlideRasterResult(await invokeHiddenWorker('slides-raster', request));
      if (raster.status === 'failure') throw new Error(raster.error.message);
      const { data, info } = await sharp(raster.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const pixel = (x: number, y: number) => {
        const index = (y * info.width + x) * info.channels;
        return [...data.subarray(index, index + 3)].join(',');
      };
      // 左红右蓝绕 (3,3) 旋转后应上下分布；水平镜像应交换上下颜色，不能改变外盒。
      const redOnTop = (rotation === 90) !== (visual.kind === 'image' && visual.flipH === true);
      const top = visual.kind === 'shape' || redOnTop ? '255,0,0' : '0,0,255';
      const bottom = visual.kind === 'shape' || !redOnTop ? '255,0,0' : '0,0,255';
      const wide = visual.kind === 'svgGraphic' && visual.fit === 'stretch';
      if (pixel(300, 200) !== top || pixel(300, 400) !== bottom
        || pixel(150, 200) !== (wide ? top : '255,255,255')) {
        throw new Error(`Pixels disagree with center rotation: ${visual.id}/${rotation}`);
      }
    }
  }
  console.log('Center rotation passed: SVG contain/stretch, Shape rect/ellipse, Image with/without flip; both directions');
}
