import { ZodError } from 'zod';
import { Logger } from '@plugin/backend/workspaceRuntime';
import { CanvasCliFailure, formatCanvasCliInputError } from '../features/canvasCli';
import { CanvasDocumentFailure } from '../features/canvasDocument';
import { CanvasReadOnlyFormatError, CanvasContentPolicyError, CanvasCommitFailure } from '../features/canvasCommit';
import { CanvasWriteFailure } from '../features/canvasWrite';
import { CanvasRenderingError } from '../features/canvasRender';

const messages: Readonly<Record<string, string>> = {
  render_scope_conflict: '卡片scope与九宫格region只能选一个。',
  render_region_invalid: '请使用九宫格方位，如左上、正中或右下。',
  canvas_layout_group_overlap: '一张卡只能属于一个排布组，请修正groups。',
  request_id_payload_mismatch: '此request-id已经用于不同内容，请复用原始操作或为新动作使用新编号。',
  canvas_element_not_found: '元素不存在，请重新read/show读取当前编号。',
  canvas_layout_timeout: '布局计算超时，本批没有提交；缩小范围后再试。',
  canvas_layout_queue_full: '布局队列已满，请稍后使用同一request-id重试。',
  canvas_layout_cancelled: '布局已取消。',
  canvas_approval_denied: '用户已拒绝此批次，不能用同一请求再次执行。',
  canvas_approval_replaced: '此批次已被新待确认批次替换。',
  canvas_approval_withdrawn: '此批次所属改动已撤回。',
  canvas_approval_closed: '此批次所属改动组已经完成。',
  canvas_group_missing: '改动组已不存在，请刷新画布后重试。',
  canvas_approval_expired: '待确认操作已失效，请刷新画布查看当前批次。',
  canvas_history_head_changed: '后续操作已改变撤销顺序，请使用画布撤销逐步处理。',
};

/** Renderer 和 CLI 使用同一业务失败投影；只有未识别异常才算运行错误。 */
export function projectCanvasBusinessFailure(error: unknown) {
  if (error instanceof CanvasDocumentFailure || error instanceof CanvasRenderingError || error instanceof CanvasReadOnlyFormatError || error instanceof CanvasContentPolicyError || error instanceof CanvasCommitFailure) return { code: error.code, message: error.message };
  if (error instanceof CanvasWriteFailure) return { code: error.code, message: error.message, operation: error.operation, field: error.field };
  if (error instanceof Error && messages[error.message]) return { code: error.message, message: messages[error.message] };
  if (error instanceof Error && error.name === 'AbortError') return { code: 'cancelled', message: '操作已取消。' };
  return null;
}
/** 未识别的异常保留在Host日志；模型输出不携带磁盘路径、SQL或内部身份。 */
export function createCanvasCliFailureProjector(logger: Logger) {
  return (error: unknown) => {
    if (error instanceof ZodError || error instanceof CanvasCliFailure) return formatCanvasCliInputError(error);
    const business = projectCanvasBusinessFailure(error);
    if (business) return business;
    if (error instanceof SyntaxError) return { code: 'invalid_json', message: 'ops-file必须是UTF-8 JSON操作数组，请修正语法后再提交。' };
    logger.error('Canvas CLI执行失败', { error });
    return { code: 'operation_failed', message: '操作失败，详细原因已记入应用日志。本次请求可用同一request-id查询或重试。' };
  };
}
