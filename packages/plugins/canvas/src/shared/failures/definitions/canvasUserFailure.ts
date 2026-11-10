import { z } from 'zod';

/**
 * 用户在界面里可能遇到的失败编号。
 * Backend 不知道界面语言，IPC 失败只回传编号；Renderer 按当前语言给出文案。
 * 只给 Agent/CLI 看的失败（含工具命令、字段名的提示）不在此列，仍带原文。
 */
export const CanvasUserFailureCodeSchema = z.enum([
  'canvas_image_unsupported',
  'canvas_image_too_large',
  'canvas_invalid_request',
  'canvas_operation_failed',
  'document_missing',
  'selection_removed',
  'outside_project',
  'wrong_document_type',
  'runtime_closed',
  'view_closed',
  'read_only_format',
  'unmanaged_image',
  'canvas_endpoint_missing',
  'canvas_self_connection',
  'canvas_duplicate_connection',
  'canvas_group_cycle',
  'canvas_group_parent_missing',
  'canvas_element_not_found',
  'canvas_layout_timeout',
  'canvas_layout_queue_full',
  'canvas_layout_cancelled',
  'canvas_approval_denied',
  'canvas_approval_replaced',
  'canvas_approval_withdrawn',
  'canvas_approval_closed',
  'canvas_group_missing',
  'canvas_approval_expired',
  'canvas_history_head_changed',
  'cancelled',
]);
export type CanvasUserFailureCode = z.infer<typeof CanvasUserFailureCodeSchema>;
export function isCanvasUserFailureCode(value: string): value is CanvasUserFailureCode {
  return CanvasUserFailureCodeSchema.safeParse(value).success;
}
