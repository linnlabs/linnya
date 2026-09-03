import { invokeHiddenWorker } from '@plugin/backend/hiddenWorkerRuntime';
import type { BrushArtworkGeneratorPort } from '../../../engine/brushArtwork';
import {
  SLIDES_BRUSH_WORKER_ID,
  parseBrushArtworkRenderResult,
} from '@plugin/slides/shared/brushArtwork';

export function createPresentationBrushArtworkGenerator(): BrushArtworkGeneratorPort {
  return {
    async generateBrushArtwork(request) {
      const result = parseBrushArtworkRenderResult(
        await invokeHiddenWorker(SLIDES_BRUSH_WORKER_ID, request),
      );
      if (result.status === 'failure') throw new Error(result.error.message);
      if (result.widthPx !== request.widthPx || result.heightPx !== request.heightPx) {
        throw new Error('Brush artwork worker returned unexpected dimensions.');
      }
      return {
        bytes: result.bytes,
        widthPx: result.widthPx,
        heightPx: result.heightPx,
      };
    },
  };
}
