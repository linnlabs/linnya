import { createHash } from 'node:crypto';
import { normalizeBrushArtworkIntent } from '@plugin/slides/shared';
import {
  BRUSH_ARTWORK_ADAPTER_VERSION,
  BRUSH_ARTWORK_UPSTREAM_COMMIT,
  type BrushArtworkMaterializationIdentityInput,
} from '../definitions/brushArtworkGenerator';

/**
 * binding identity 必须包含像素尺寸：同一 intent 放进不同盒子时会产生不同字节，不能 first-write-wins
 * 到第一份尺寸。GPU/runtime 不进入身份；首次接管后的 owned PNG 才是该文稿的持久字节事实。
 */
export function createBrushArtworkMaterializationIdentity(
  input: BrushArtworkMaterializationIdentityInput,
): string {
  const intent = normalizeBrushArtworkIntent(input.intent);
  const canonical = JSON.stringify({
    adapterVersion: BRUSH_ARTWORK_ADAPTER_VERSION,
    upstreamCommit: BRUSH_ARTWORK_UPSTREAM_COMMIT,
    widthPx: input.widthPx,
    heightPx: input.heightPx,
    intent: {
      seed: intent.seed,
      backgroundColor: intent.backgroundColor,
      quality: intent.quality,
      layers: intent.layers,
    },
  });
  return `brush:${createHash('sha256').update(canonical).digest('hex')}`;
}
