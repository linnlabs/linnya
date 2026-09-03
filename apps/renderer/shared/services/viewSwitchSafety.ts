import { saveDeactivateThen } from '@/domains/workspace/services/file-manager';

/**
 * 统一的“安全视图切换”封装。
 *
 * 中文说明（根因）：
 * - 插件文档引擎可能会在视图卸载时销毁；
 * - 若先切走视图（引擎销毁）再触发 `requestSave('view-switch')`，就会出现 `NO_ENGINE`；
 * - 这个函数保证顺序：先保存 -> 再关闭会话 -> 最后执行实际视图切换动作。
 */
export async function safeSwitchView(action: () => void | Promise<void>): Promise<void> {
  console.debug('[safeSwitchView] entry');
  await saveDeactivateThen(action, { throwOnSaveFailure: true });
}
