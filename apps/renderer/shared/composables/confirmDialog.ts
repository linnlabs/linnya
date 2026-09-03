/**
 * @file confirmDialog.ts
 * @description
 * 统一的“确认对话框”能力（应用内实现，不使用 window.confirm）。
 *
 * 背景（根因说明）：
 * - 在 Electron（尤其 Windows + 无边框窗口 frame:false）中使用 window.confirm/window.alert 触发的是原生模态对话框。
 * - 原生模态关闭后，焦点恢复在部分环境不稳定，可能出现“按钮可点但输入无法聚焦/不出光标”的问题。
 *
 * 解决思路：
 * - 禁用 window.confirm 的使用，改为应用内 Modal（AlertDialog）实现确认框。
 * - 由 `GlobalModals.vue` 统一渲染 `AlertDialog`，调用方仅 `await confirm(...)`。
 */

import { reactive } from 'vue';
import type { AlertDialogSection } from '@linnya/renderer-ui';

export interface ConfirmDialogOptions {
  title?: string;
  message: string;
  sections?: readonly AlertDialogSection[];
  riskMessage?: string;
  confirmText?: string;
  cancelText?: string;
  width?: string;
  /**
   * 是否危险操作（会让确认按钮呈现危险样式）
   * 例如：删除、清空等
   */
  isDangerousAction?: boolean;
}

interface ConfirmDialogState {
  visible: boolean;
  title: string;
  message: string;
  sections: readonly AlertDialogSection[];
  riskMessage: string;
  confirmText: string;
  cancelText: string;
  width: string;
  isDangerousAction: boolean;
  /**
   * 当前弹窗的 Promise resolver。
   * 注意：这是运行期状态，不需要持久化。
   */
  resolver: ((confirmed: boolean) => void) | null;
}

/**
 * 全局唯一的确认弹窗状态（由 GlobalModals.vue 渲染 AlertDialog）
 */
export const confirmDialogState = reactive<ConfirmDialogState>({
  visible: false,
  title: '',
  message: '',
  sections: [],
  riskMessage: '',
  confirmText: '',
  cancelText: '',
  width: '400px',
  isDangerousAction: false,
  resolver: null,
});

/**
 * 打开确认弹窗，返回用户选择结果。
 * - true：确认
 * - false：取消/关闭
 */
export function confirm(options: ConfirmDialogOptions): Promise<boolean> {
  /**
   * 同一时间只允许一个确认对话框。
   * 如果业务上需要“队列弹窗”，应在调用侧串行化（避免并发覆盖 resolver）。
   */
  if (confirmDialogState.visible || confirmDialogState.resolver) {
    throw new Error('[confirmDialog] 同一时间只能打开一个确认对话框，请检查调用链是否并发触发。');
  }

  confirmDialogState.title = options.title ?? '';
  confirmDialogState.message = options.message;
  confirmDialogState.sections = options.sections ?? [];
  confirmDialogState.riskMessage = options.riskMessage ?? '';
  confirmDialogState.confirmText = options.confirmText ?? '';
  confirmDialogState.cancelText = options.cancelText ?? '';
  confirmDialogState.width = options.width ?? '400px';
  confirmDialogState.isDangerousAction = Boolean(options.isDangerousAction);
  confirmDialogState.visible = true;

  return new Promise<boolean>((resolve) => {
    confirmDialogState.resolver = resolve;
  });
}

/**
 * 由 GlobalModals.vue 调用：用户确认
 */
export function resolveConfirmDialog(): void {
  const resolver = confirmDialogState.resolver;
  confirmDialogState.visible = false;
  confirmDialogState.resolver = null;
  if (resolver) resolver(true);
}

/**
 * 由 GlobalModals.vue 调用：用户取消/关闭
 */
export function cancelConfirmDialog(): void {
  const resolver = confirmDialogState.resolver;
  confirmDialogState.visible = false;
  confirmDialogState.resolver = null;
  if (resolver) resolver(false);
}
