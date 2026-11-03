import { buildDocumentView, sliceTextWindow } from '@app/schemas';
import type { DocumentTypeBackendHook } from '@plugin/backend/documentTypeBackendHook';
import { isPluginRuntimeEnabled } from '@plugin/backend/pluginRuntime';
import { CANVAS_DOCUMENT_TYPE, CANVAS_FILE_EXTENSION, CANVAS_PLUGIN_ID } from '../../shared';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import type { CanvasDocumentRuntime } from '../orchestration/createCanvasDocumentRuntime';
import { readCanvasHostDatabase } from '../functions/readCanvasHostContext';
import { readCanvasSnapshot } from '../features/canvasCommit';
import { CanvasDocumentFailure, readCanvasProjectionContext } from '../features/canvasDocument';
import { projectCanvasDocument } from '../features/canvasProjection';

export function createCanvasDocumentHook(runtimeFor: (database: CanvasDatabase) => CanvasDocumentRuntime): DocumentTypeBackendHook {
  return {
    docType: CANVAS_DOCUMENT_TYPE, displayName: '画布', fileExtension: CANVAS_FILE_EXTENSION,
    isEnabled: () => isPluginRuntimeEnabled(CANVAS_PLUGIN_ID),
    createDocument(params) {
      const documentId = runtimeFor(readCanvasHostDatabase(params.context)).create(params);
      return { documentId };
    },
    writeDocument() {
      throw new CanvasDocumentFailure('projection_read_only', '画布投影只读。请使用 linnya-canvas apply 批量修改，不要用 write_file/edit_file 覆盖。');
    },
    readEditorDocument(params) { return { content: readCanvasSnapshot(params.db, params.documentId) }; },
    readVfsContent(params) {
      const snapshot = readCanvasSnapshot(params.db, params.nodeId);
      return { contentType: 'text/markdown', text: projectCanvasDocument(snapshot, readCanvasProjectionContext(params.db, snapshot)),
        metadata: { versionNumber: snapshot.sequence, sourceKey: String(snapshot.sequence), readOnlyProjection: true } };
    },
    readDocument(params) {
      const runtime = runtimeFor(readCanvasHostDatabase(params.context));
      const text = runtime.project(params.documentId);
      const window = sliceTextWindow(text, params.offsetChars, params.maxChars, true);
      return { observation: buildDocumentView({ documentId: params.documentId, docType: CANVAS_DOCUMENT_TYPE,
        offsetChars: params.offsetChars, truncatedByChars: window.truncated, totalTextLength: window.totalLength, nextOffset: window.nextOffset }, window.text),
      data: { documentId: params.documentId, documentName: params.documentName, docType: CANVAS_DOCUMENT_TYPE,
        totalTextLength: window.totalLength, truncatedByChars: window.truncated, nextOffset: window.nextOffset,
        presentation: { kind: 'text', text: window.text } } };
    },
  };
}
