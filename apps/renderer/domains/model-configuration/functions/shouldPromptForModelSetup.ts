import type { ModelPickerSnapshot } from '@app/schemas/model-picker';

/**
 * 首次启动时只在没有任何用户可用模型的情况下提示配置。
 * Provider 与自定义模型都属于已完成配置的事实；snapshot 尚未加载时保持原输入区，
 * 让启动过程不会因为网络/后台初始化的时序变化而闪烁或误阻塞。
 */
export function shouldPromptForModelSetup(
  snapshot: ModelPickerSnapshot | null,
  inputDisabled: boolean
): boolean {
  if (!snapshot || inputDisabled) return false;
  return snapshot.providers.length === 0 && snapshot.custom_models.length === 0;
}
