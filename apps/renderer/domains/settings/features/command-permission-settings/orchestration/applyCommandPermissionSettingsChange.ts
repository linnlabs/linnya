import {
  CommandPermissionSettingsUpdateV1Schema,
} from '@app/schemas/commands';

import type { CommandPermissionSettingsChange } from '../definitions/commandPermissionSettingsChange';
import { projectCommandPermissionSettings } from '../definitions/commandPermissionSettingsProjection';
import { isCommandPermissionExpansion } from '../functions/isCommandPermissionExpansion';
import {
  commandPermissionSettingsGateway,
  type CommandPermissionSettingsGateway,
} from '../infrastructure/commandPermissionSettingsGateway';
import { useCommandPermissionSettingsStore } from '../store/commandPermissionSettingsStore';

export interface ApplyCommandPermissionSettingsChangeOptions {
  readonly gateway?: CommandPermissionSettingsGateway;
  readonly confirmExpansion?: () => Promise<boolean>;
}

/**
 * 设置页采用即时保存，因此一次用户选择必须独立完成确认、持久化和界面回滚。
 * 取消或失败时恢复后端真实值，避免控件继续显示一个从未生效的草稿。
 */
export async function applyCommandPermissionSettingsChange(
  change: CommandPermissionSettingsChange,
  options: ApplyCommandPermissionSettingsChangeOptions = {},
): Promise<void> {
  const store = useCommandPermissionSettingsStore();
  if (!store.projection
    || store.saveState === 'saving'
    || store.saveState === 'confirming') return;

  if (change.kind === 'permission_level') {
    store.editPermissionLevel(change.value);
  } else {
    store.editInternalDataAccess(change.value);
  }

  const backend = store.projection;
  const draft = store.draft;
  if (!draft || !store.isDirty) return;

  if (isCommandPermissionExpansion({ current: backend, next: draft })) {
    store.beginConfirmation();
    try {
      const confirmed = await options.confirmExpansion?.() ?? false;
      if (!confirmed) {
        store.restoreDraftFromProjection();
        return;
      }
    } catch {
      store.restoreDraftFromProjection();
      return;
    }
  }

  store.beginSave();
  try {
    const gateway = options.gateway ?? commandPermissionSettingsGateway;
    const result = await gateway.update(CommandPermissionSettingsUpdateV1Schema.parse({
      schema_version: 1,
      kind: 'command_permission_settings_update',
      expected_revision: backend.revision,
      permission_level: draft.permissionLevel,
      internal_data_access: draft.internalDataAccess,
    }));
    if (result.success) {
      store.saveSucceeded(projectCommandPermissionSettings(result.settings));
      return;
    }
    store.saveFailed({
      code: result.code,
      ...('settings' in result
        ? { backend: projectCommandPermissionSettings(result.settings) }
        : {}),
    });
  } catch {
    store.saveFailed({ code: 'read_failed' });
  }
}
