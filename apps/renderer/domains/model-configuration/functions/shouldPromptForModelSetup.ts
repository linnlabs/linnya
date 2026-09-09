import type { ModelPickerSnapshot } from '@app/schemas/model-picker';

/**
 * 只有当前没有已配置 Provider 且没有自定义模型时才提示配置。
 * 自定义模型视为特殊 Provider 配置，snapshot 尚未加载时保持原输入区，
 * 让初始化过程不会因为网络/后台状态尚未就绪而闪烁或误阻塞。
 */
export function shouldPromptForModelSetup(
  snapshot: ModelPickerSnapshot | null,
  inputDisabled: boolean
): boolean {
  if (!snapshot || inputDisabled) return false;
  return snapshot.providers.length === 0 && snapshot.custom_models.length === 0;
}
