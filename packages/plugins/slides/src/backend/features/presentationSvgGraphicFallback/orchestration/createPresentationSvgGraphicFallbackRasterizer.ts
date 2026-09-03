import { randomUUID } from 'node:crypto';
import type {
  SvgGraphicFallbackRasterizerPort,
} from '@plugin/slides/backend-engine-core';
import type {
  SlideRasterRequest,
  SlideRasterResult,
} from '@plugin/slides/shared/slideRasterization';
import { resolveSvgGraphicFallbackPixelSize } from '../functions/resolveSvgGraphicFallbackPixelSize';

type InvokeRaster = (request: SlideRasterRequest) => Promise<SlideRasterResult>;

/** 把 engine 的窄 raster port 适配到现有隔离 hidden worker。 */
export function createPresentationSvgGraphicFallbackRasterizer(
  invokeRaster: InvokeRaster = invokeRasterWithSlidesWorker,
): SvgGraphicFallbackRasterizerPort {
  return {
    async rasterizeSvgGraphic(input) {
      const pixelSize = resolveSvgGraphicFallbackPixelSize(input.viewBox);
      const slideSize = {
        width: pixelSize.widthPx / 96,
        height: pixelSize.heightPx / 96,
        unit: 'in' as const,
      };
      const result = await invokeRaster({
        requestId: `svg-fallback-${randomUUID()}`,
        slide: {
          slideId: `svg-fallback-${input.contentHash}`,
          index: 0,
          layoutKey: 'svg-graphic-fallback',
          background: { paint: { type: 'none' } },
          elements: [{
            id: `svg-${input.contentHash}`,
            kind: 'svgGraphic',
            box: { x: 0, y: 0, w: slideSize.width, h: slideSize.height, unit: 'in' },
            zIndex: 0,
            canonicalSvg: input.canonicalSvg,
            contentHash: input.contentHash,
            viewBox: input.viewBox,
            fit: 'stretch',
            decorative: true,
          }],
        },
        slideSize,
        profile: {
          id: 'svg-graphic-fallback-v1',
          viewportWidthPx: pixelSize.widthPx,
          viewportHeightPx: pixelSize.heightPx,
          pixelRatio: 1,
          format: 'png',
          transparentBackground: true,
        },
      });
      if (result.status === 'failure') {
        throw new Error(`${result.error.code}: ${result.error.message}`);
      }
      return {
        pngBytes: result.bytes,
        widthPx: result.widthPx,
        heightPx: result.heightPx,
      };
    },
  };
}

async function invokeRasterWithSlidesWorker(
  request: SlideRasterRequest,
): Promise<SlideRasterResult> {
  // backend contribution 必须能在纯 Node 的插件发现阶段加载；Electron worker
  // 运行时只在真正导出含 SVG Graphic 的文稿时进入依赖图。
  const { invokeSlidesRasterWorker } = await import(
    '../../slideRasterWorker/orchestration/invokeSlidesRasterWorker'
  );
  return invokeSlidesRasterWorker(request);
}
