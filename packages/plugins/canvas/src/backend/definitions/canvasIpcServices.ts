import type { CanvasDocumentRuntime } from '../orchestration/createCanvasDocumentRuntime';
import type { createCanvasImageRuntime } from '../orchestration/createCanvasImageRuntime';
import type { createCanvasArrangementRuntime } from '../orchestration/createCanvasArrangementRuntime';
/** 每次启用拥有一组实例，IPC注册不永久捕获已经停用的worker/文档运行态。 */
export interface CanvasIpcServices {
  readonly runtime: CanvasDocumentRuntime;
  readonly images: ReturnType<typeof createCanvasImageRuntime>;
  readonly arrangement: ReturnType<typeof createCanvasArrangementRuntime>;
}
