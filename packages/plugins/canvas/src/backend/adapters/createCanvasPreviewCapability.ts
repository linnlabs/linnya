import { CANVAS_PREVIEW_SUMMARY_LIMIT } from '../definitions/canvasProjectionLimits';
import { canvasTextPrefix } from '../../shared';
import { randomUUID } from 'node:crypto';
import type { DocumentPreviewCapability } from '@plugin/backend/documentPreview';
import type { CanvasBackendCapabilities } from '../definitions/canvasBackendCapabilities';
import { readCanvasHostDatabase } from '../functions/readCanvasHostContext';
import { readCanvasSnapshot, readCanvasSequence } from '../features/canvasCommit';
import { readCanvasDocumentIdentity, readCanvasProjectionContext } from '../features/canvasDocument';
import { projectCanvasSearchText } from '../features/canvasProjection';
import { readCanvasRenderingResources } from '../orchestration/readCanvasRenderingResources';
import { CanvasRenderRequestSchema } from '../../shared/rendering';
import { CANVAS_DEFAULT_FONT_FAMILY, CANVAS_DEFAULT_FONT_SIZE } from '../../shared/rendering/definitions/canvasTypography';

/** 同一正式worker出封面；内部Canvas引用永远是身份牌，由资源装配防止互引递归。 */
export function createCanvasPreviewCapability(capabilities: () => CanvasBackendCapabilities): DocumentPreviewCapability {
  return {
    getRevision(input) {
      const database = readCanvasHostDatabase(input.context);
      readCanvasDocumentIdentity(database, input.documentId);
      return String(readCanvasSequence(database, input.documentId));
    },
    async render(input) {
      const database = readCanvasHostDatabase(input.context);
      readCanvasDocumentIdentity(database, input.documentId);
      const snapshot = readCanvasSnapshot(database, input.documentId);
      const signal = input.signal ?? new AbortController().signal;
      const resources = await readCanvasRenderingResources({ database, snapshot, signal, covers: true });
      const result = await capabilities().rendering.render(CanvasRenderRequestSchema.parse({ protocol: 1, requestId: randomUUID(), kind: 'render', snapshot, ...resources,
        theme: 'light', width: input.widthPx, height: Math.round(input.widthPx * 0.625), dpr: input.pixelRatio, fontFamily: CANVAS_DEFAULT_FONT_FAMILY,
        fontSize: CANVAS_DEFAULT_FONT_SIZE, region: null, format: 'png', quality: 1, material: 'paper' }), signal);
      return { revisionKey: String(snapshot.sequence), summary: canvasTextPrefix(projectCanvasSearchText(snapshot, readCanvasProjectionContext(database, snapshot)), CANVAS_PREVIEW_SUMMARY_LIMIT),
        image: { dataUri: `data:image/png;base64,${Buffer.from(result.bytes).toString('base64')}`, widthPx: result.width, heightPx: result.height } };
    },
  };
}
