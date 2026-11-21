import {
  compareCommandPermissionLevels,
  resolveConversationCommandPermission,
  type CommandPermissionLevel,
  type CommandPermissionSettingsV1,
  type ConversationCommandPermissionChange,
  type ConversationCommandPermissionRequest,
  type ConversationCommandPermissionResult,
  type ConversationCommandPermissionSelection,
} from '@app/schemas/commands';
import {
  CommandPermissionSettingsError,
  readCommandPermissionSettings,
  updateCommandPermissionSettings,
} from 'src/domains/commands/features/permission-settings';
import type { CommandPermissionSettingsPort } from 'src/domains/commands/ports';

import type { ConversationWorkDirectoryAdmissionPort } from '../../conversation-lifecycle';
import type {
  ConversationCommandPermissionPersistencePort,
  ConversationCommandPermissions,
  ConversationPermissionTarget,
} from '../definitions/conversationCommandPermissions';
import { fingerprintCommandPermissionReduction, planCommandPermissionChange } from '../functions/planCommandPermissionChange';

type Request = ConversationCommandPermissionRequest;
type Result = ConversationCommandPermissionResult;
const followsGlobal: ConversationCommandPermissionSelection = Object.freeze({ permission_level: null, revision: 0 });

export function createConversationCommandPermissions(input: {
  readonly store: ConversationCommandPermissionPersistencePort;
  readonly globalSettings: CommandPermissionSettingsPort;
  readonly admission: ConversationWorkDirectoryAdmissionPort;
  readonly onFailure: (error: unknown) => void;
}): ConversationCommandPermissions {
  const { store, globalSettings, admission, onFailure } = input;
  const selections = new Map(store.loadSelections().map(
    ({ conversation_id, created_at, ...selection }) => [
      conversation_id,
      { createdAt: created_at, selection: Object.freeze(selection) },
    ],
  ));

  function readSelection(id: string): ConversationCommandPermissionSelection {
    const stored = selections.get(id);
    if (!stored) return followsGlobal;
    // 会话清理后，同一 ID 的新会话不继承旧权限。只查询身份，档位始终从内存 owner 取。
    let createdAt: number | undefined;
    try {
      createdAt = store.resolveTarget(id)?.created_at;
    } catch (error: unknown) {
      onFailure(error);
      throw new CommandPermissionSettingsError('read_failed', '无法读取对话权限身份');
    }
    if (createdAt !== stored.createdAt) {
      selections.delete(id);
      return followsGlobal;
    }
    return stored.selection;
  }

  function publishSelection(id: string, createdAt: number, change: ConversationCommandPermissionChange): void {
    const selection = Object.freeze({ permission_level: change.next_selection, revision: change.revision });
    selections.set(id, { createdAt, selection });
  }

  function readView(target: ConversationPermissionTarget | null, global: CommandPermissionSettingsV1): Result {
    const id = target?.conversation_id;
    const storedTarget = id ? store.resolveTarget(id) : null;
    if (storedTarget && storedTarget.project_id !== target?.project_id) {
      return { kind: 'error', code: 'not_found' };
    }
    const selection = id && storedTarget ? readSelection(id) : followsGlobal;
    return {
      kind: 'view',
      view: {
        selection,
        ...resolveConversationCommandPermission(global.permission_level, selection.permission_level),
        global_level: global.permission_level,
        global_revision: global.revision,
      },
    };
  }

  function commitSelection(
    target: ConversationPermissionTarget,
    existing: { readonly created_at: number } | null,
    change: ConversationCommandPermissionChange,
  ): void {
    const id = target.conversation_id;
    store.transact(() => {
      if (!existing) store.materializeConversation(target, change.changed_at_ms);
      store.writeChange(id, change);
    });
    publishSelection(id, existing?.created_at ?? change.changed_at_ms, change);
  }

  function setSelection(request: Extract<Request, { kind: 'set' }>): Promise<Result> {
    const { target, permission_level: next } = request;
    return admission.withAdmission({ conversationId: target.conversation_id }, () => {
      const global = readCommandPermissionSettings(globalSettings);
      const id = target.conversation_id;
      const existing = store.resolveTarget(id);
      if ((!existing && !request.create) || (existing && existing.project_id !== target.project_id)) {
        return { kind: 'error', code: 'not_found' };
      }
      const current = existing ? readSelection(id) : followsGlobal;
      if (current.revision !== request.expected_revision || global.revision !== request.expected_global_revision) {
        return { kind: 'error', code: 'conflict' };
      }
      const at = Date.now();
      const change = planCommandPermissionChange({
        current, next, globalLevel: global.permission_level, origin: 'desktop', at,
      });
      if (change) commitSelection(target, existing, change);
      return readView(target, global);
    });
  }

  function planReduction(global: CommandPermissionSettingsV1, target: CommandPermissionLevel) {
    const affected = [];
    for (const [id, { createdAt }] of selections) {
      const selection = readSelection(id);
      if (selection.permission_level !== null && compareCommandPermissionLevels(selection.permission_level, target) > 0) {
        affected.push({ id, revision: selection.revision, createdAt });
      }
    }
    return {
      affected,
      preview: {
        global_revision: global.revision,
        target_level: target,
        affected_count: affected.length,
        fence: fingerprintCommandPermissionReduction(affected),
      },
    };
  }

  function completePendingReduction(): Result {
    const pending = store.readPendingReduction();
    if (!pending) return { kind: 'error', code: 'conflict' };
    const { update, changedCount } = pending;
    const global = readCommandPermissionSettings(globalSettings);
    if (global.revision === update.expected_revision) {
      try {
        updateCommandPermissionSettings({ port: globalSettings, update });
      } catch (error: unknown) {
        if (!(error instanceof CommandPermissionSettingsError) || error.code !== 'write_failed') throw error;
        onFailure(error);
        return { kind: 'partial', changed_count: changedCount };
      }
    } else if (global.revision !== update.expected_revision + 1
      || global.permission_level !== update.permission_level
      || global.internal_data_access !== update.internal_data_access) {
      store.clearPendingReduction();
      return { kind: 'error', code: 'conflict' };
    }
    store.clearPendingReduction();
    return { kind: 'reduced', changed_count: changedCount };
  }

  function reduce(request: Extract<Request, { kind: 'reduce' }>, global: CommandPermissionSettingsV1): Result {
    const target = request.preview.target_level;
    const { affected, preview } = planReduction(global, target);
    if (request.preview.global_revision !== global.revision || request.preview.fence !== preview.fence
      || request.preview.affected_count !== preview.affected_count
      || compareCommandPermissionLevels(target, global.permission_level) >= 0) {
      return { kind: 'error', code: 'conflict' };
    }
    const pending = store.readPendingReduction();
    if (pending?.update.permission_level === target && pending.update.expected_revision === global.revision
      && (!request.include_conversations || affected.length === 0)) {
      return completePendingReduction();
    }

    const update = {
      schema_version: 1,
      kind: 'command_permission_settings_update',
      expected_revision: global.revision,
      permission_level: target,
      internal_data_access: global.internal_data_access,
    } as const;
    const at = Date.now();
    const changed = new Map<string, { createdAt: number; change: ConversationCommandPermissionChange }>();
    store.transact(() => {
      if (pending) store.clearPendingReduction();
      for (const { id, createdAt } of request.include_conversations ? affected : []) {
        const change = planCommandPermissionChange({
          current: readSelection(id), next: target, globalLevel: global.permission_level,
          origin: 'global_reduction', at,
        });
        if (!change) continue;
        store.writeChange(id, change);
        changed.set(id, { createdAt, change });
      }
      store.savePendingReduction(update, changed.size);
    });
    for (const [id, { createdAt, change }] of changed) publishSelection(id, createdAt, change);
    return completePendingReduction();
  }

  // 崩溃发生在两处持久化之间时，只继续已确认的操作。新档位在完成对账后才可见。
  try {
    completePendingReduction();
  } catch (error: unknown) {
    onFailure(error);
  }

  return {
    readSelection,
    async initializeForNewConversation(target, level) {
      await admission.withAdmission({ conversationId: target.conversation_id }, () => {
        if (store.resolveTarget(target.conversation_id)) throw new Error('对话已存在，不能设置初始档位');
        const global = readCommandPermissionSettings(globalSettings);
        const change = planCommandPermissionChange({
          current: followsGlobal, next: level, globalLevel: global.permission_level,
          origin: 'host_initialization', at: Date.now(),
        });
        if (change) commitSelection(target, null, change);
      });
    },
    async request(request) {
      try {
        const global = readCommandPermissionSettings(globalSettings);
        switch (request.kind) {
          case 'read': return readView(request.target, global);
          case 'set': return await setSelection(request);
          case 'preview_reduction': return { kind: 'preview', preview: planReduction(global, request.permission_level).preview };
          case 'reduce': return reduce(request, global);
        }
      } catch (error: unknown) {
        onFailure(error);
        return { kind: 'error', code: 'unavailable' };
      }
    },
  };
}
