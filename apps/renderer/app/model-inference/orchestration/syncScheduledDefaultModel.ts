import { watch } from 'vue';
import { readEffectiveModelPurposeBinding } from '@/domains/model-configuration';

/** App Server 可能在界面加载前运行；同步设置的模型身份，不复制主模型选择规则。 */
export function syncScheduledDefaultModel(): () => void {
  const bridge = window.electronAPI?.scheduledTasks;
  if (!bridge) return () => {};
  return watch(() => readEffectiveModelPurposeBinding('primary'), modelId => {
    void bridge.setSettings({ default_model_config_id: modelId }).catch(error => {
      console.warn('[ScheduledTasks] 无法同步当前默认模型', error);
    });
  }, { immediate: true });
}
