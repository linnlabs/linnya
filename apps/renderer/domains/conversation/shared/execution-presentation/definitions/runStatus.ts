import type { ToolUiActivity } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { ConversationMessageKey } from '../../../definitions/conversationMessages';

/**
 * 底部状态行的运行信号：全部来自 Renderer 已经拿到的事实（运行控制快照、命令审批投影、
 * 本轮消息的类型与完成状态、工具 owner 声明的活动类别）。不新增 Runtime 字段，也不猜测后台。
 */
export type RunStatusSignal =
  | { readonly kind: 'starting' }
  | { readonly kind: 'thinking'; readonly thoughtMs: number }
  | { readonly kind: 'tool'; readonly activity: ToolUiActivity | undefined }
  | { readonly kind: 'after_tool' }
  | { readonly kind: 'answering' }
  | { readonly kind: 'working' }
  | { readonly kind: 'awaiting_answer' }
  | { readonly kind: 'awaiting_approval' }
  | { readonly kind: 'compacting' }
  | { readonly kind: 'retrying' }
  | { readonly kind: 'paused' };

/**
 * 运行中图标一律是 Linnya 标识的“摇曳”（LinnyaLoadingIcon 的 thinking 动态），不按状态换动态：
 * 用户 2026-11-26 定，沿用原底部等待图标的摇曳。
 * `still` 表示球在用户这边（等回答、等批准、已暂停），图标静止变灰。
 */
export type RunStatusMotion = 'sway' | 'still';

export interface RunStatusText {
  readonly labelKey: ConversationMessageKey;
  readonly motion: RunStatusMotion;
}

/** 状态行展示模型：文字已按当前语言解析，时长已格式化。 */
export interface RunStatusRowView {
  readonly text: string;
  readonly elapsedText: string;
  readonly motion: RunStatusMotion;
}

/** 同一段思考超过这个时长换成“苦思冥想中”。 */
export const RUN_STATUS_LONG_THOUGHT_MS = 30_000;

/** 每条文字至少停留这么久再换，避免工具一个接一个很快结束时文字闪烁。 */
export const RUN_STATUS_MIN_DWELL_MS = 2_000;

/** 状态行每秒刷新一次：时长按秒显示，思考是否超过 30 秒、文字是否已停留够也按秒判断。 */
export const RUN_STATUS_TICK_MS = 1_000;
