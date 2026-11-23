import { ref, shallowRef } from 'vue';
import type { CommandPermissionLevel, CommandPermissionReductionPreview } from '@app/schemas/commands';

import { requestConversationCommandPermission } from '@/app/workflows/command-permissions';
import { projectCommandPermissionSettings } from '../definitions/commandPermissionSettingsProjection';
import { commandPermissionSettingsGateway } from '../infrastructure/commandPermissionSettingsGateway';
import { useCommandPermissionSettingsStore } from '../store/commandPermissionSettingsStore';

export function useCommandPermissionReduction() {
  const store = useCommandPermissionSettingsStore();
  const preview = shallowRef<CommandPermissionReductionPreview>();
  const partialCount = ref<number>();

  function cancel() {
    preview.value = undefined;
    store.restoreDraftFromProjection();
  }

  async function apply(includeConversations: boolean) {
    const current = preview.value;
    if (!current) return;
    preview.value = undefined;
    store.beginSave();
    const result = await requestConversationCommandPermission({
      kind: 'reduce',
      preview: current,
      include_conversations: includeConversations,
      // 定时任务与对话同一个选择：确认框里一起列出，一起调低或都不调。
      include_scheduled_tasks: includeConversations,
    });
    try {
      const settings = await commandPermissionSettingsGateway.read();
      if (result.kind === 'reduced' && settings.success) {
        store.saveSucceeded(projectCommandPermissionSettings(settings.settings));
        return;
      }
      if (result.kind === 'partial') partialCount.value = result.changed_count;
      store.saveFailed({
        code: result.kind === 'error' && result.code === 'conflict' ? 'revision_conflict' : 'write_failed',
        backend: settings.success ? projectCommandPermissionSettings(settings.settings) : undefined,
      });
    } catch {
      store.saveFailed({ code: 'read_failed' });
    }
  }

  async function prepare(target: CommandPermissionLevel) {
    partialCount.value = undefined;
    store.beginConfirmation();
    const result = await requestConversationCommandPermission({ kind: 'preview_reduction', permission_level: target });
    if (result.kind !== 'preview') {
      store.saveFailed({ code: 'read_failed' });
      return;
    }
    preview.value = result.preview;
    if (result.preview.affected_count === 0 && (result.preview.scheduled_task_count ?? 0) === 0) await apply(false);
  }

  return { preview, partialCount, prepare, cancel, apply };
}
