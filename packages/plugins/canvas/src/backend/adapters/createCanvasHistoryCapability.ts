import type { DocumentHistoryCapability } from '@plugin/backend/documentHistory';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import type { CanvasDocumentRuntime } from '../orchestration/createCanvasDocumentRuntime';
import { readCanvasHostDatabase } from '../functions/readCanvasHostContext';

/** 通用历史面板只看摘要与恢复请求，画布会话和版本载荷仍由插件拥有。 */
export function createCanvasHistoryCapability(
  runtimeFor: (database: CanvasDatabase) => CanvasDocumentRuntime
): DocumentHistoryCapability {
  return {
    list(input) {
      return runtimeFor(readCanvasHostDatabase(input.context)).history.list(input.documentId);
    },
    restore({ context, ...request }) {
      return runtimeFor(readCanvasHostDatabase(context)).history.restore(request);
    },
  };
}
