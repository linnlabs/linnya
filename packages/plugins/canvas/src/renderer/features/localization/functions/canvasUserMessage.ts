import { isCanvasUserFailureCode } from '@plugin/canvas/shared';
import { canvasText } from './canvasText';

/** 画布自己按当前语言写的提示，可以原样给用户看。 */
export class CanvasUserError extends Error {
  override readonly name: string = 'CanvasUserError';

  /** detail 保存触发它的原文（例如宿主错误），只用于日志与排查，不显示。 */
  constructor(
    message: string,
    readonly detail?: unknown
  ) {
    super(message);
  }
}

/** Host 文档预览声明可展示的失败；消息已按当前语言生成。 */
const DISPLAYABLE_HOST_ERROR = 'DocumentPreviewUserError';

/** 能说清原因的内部失败，换成当前语言的说明。 */
const KNOWN_INTERNAL_FAILURES = {
  canvas_2d_unavailable: 'canvas.error.drawingUnavailable',
  canvas_webgl_required: 'canvas.error.drawingUnavailable',
  html_canvas_unavailable: 'canvas.error.htmlDrawingUnavailable',
  canvas_graphics_context_lost: 'canvas.error.graphicsContextLost',
} as const;

function isKnownInternalFailure(value: string): value is keyof typeof KNOWN_INTERNAL_FAILURES {
  return Object.prototype.hasOwnProperty.call(KNOWN_INTERNAL_FAILURES, value);
}

/**
 * 失败给用户看的那句话。画布自己的提示、后端回传的失败编号与 Host 声明可展示的消息照常显示；
 * 其余（IPC、数据库、渲染环境等）的原文属于内部细节，只进日志，界面给与后端同一句的通用提示。
 */
export function canvasUserMessage(failure: unknown): string {
  if (failure instanceof CanvasUserError) return failure.message;
  if (failure instanceof Error) {
    if (failure.name === DISPLAYABLE_HOST_ERROR && failure.message) return failure.message;
    if (isCanvasUserFailureCode(failure.message))
      return canvasText(`canvas.failure.${failure.message}`);
    if (isKnownInternalFailure(failure.message)) {
      console.warn('[Canvas] 已知失败', failure);
      return canvasText(KNOWN_INTERNAL_FAILURES[failure.message]);
    }
  }
  console.warn('[Canvas] 未预期的失败', failure);
  return canvasText('canvas.failure.canvas_operation_failed');
}
