import { Buffer } from 'node:buffer';

import { DeckAssembler } from '../../../engine/DeckAssembler';
import { FreeformCompiler } from '../../../engine/FreeformCompiler';
import { StructuredCompiler } from '../../../engine/StructuredCompiler';
import type {
  SvgGraphicAssetResolverPort,
  SvgGraphicFallbackRasterizerPort,
} from '../../../engine/types';

import type { PresentationMaterializationInput } from '../definitions/presentationBuildExecution';

/**
 * 纯计算 PPTX 物化入口。
 *
 * 所有图片已是 data URI，SVG 与 PNG fallback 也已在 DTO 中；这里不访问文件、
 * 数据库、workspace 或 hidden renderer，只执行 PptxGenJS 与 ZIP 处理。
 */
export async function materializePresentationPptx(
  input: PresentationMaterializationInput,
): Promise<ArrayBuffer> {
  const svgAssets = new Map(input.svgAssets.map(asset => [asset.assetId, asset]));
  const svgFallbacks = new Map(input.svgFallbacks.map(fallback => [
    fallback.contentHash,
    fallback,
  ]));

  const svgAssetResolver: SvgGraphicAssetResolverPort = {
    async resolveSvgGraphicAsset(ref) {
      const asset = svgAssets.get(ref.assetId);
      if (!asset || asset.contentHash !== ref.contentHash) {
        throw new Error('Slides materialization cannot resolve the prepared SVG asset.');
      }
      return asset;
    },
  };
  const svgFallbackRasterizer: SvgGraphicFallbackRasterizerPort = {
    async rasterizeSvgGraphic(request) {
      const fallback = svgFallbacks.get(request.contentHash);
      if (!fallback) {
        throw new Error('Slides materialization cannot resolve the prepared SVG fallback.');
      }
      return {
        pngBytes: fallback.pngBytes,
        widthPx: fallback.widthPx,
        heightPx: fallback.heightPx,
      };
    },
  };

  const buffer = await new DeckAssembler(
    new StructuredCompiler(),
    new FreeformCompiler(),
    undefined,
    undefined,
    svgAssetResolver,
    svgFallbackRasterizer,
  ).assemble(input.deckSpec);
  return toExactArrayBuffer(buffer);
}

function toExactArrayBuffer(buffer: Buffer): ArrayBuffer {
  if (
    buffer.buffer instanceof ArrayBuffer
    && buffer.byteOffset === 0
    && buffer.byteLength === buffer.buffer.byteLength
  ) {
    return buffer.buffer;
  }
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}
