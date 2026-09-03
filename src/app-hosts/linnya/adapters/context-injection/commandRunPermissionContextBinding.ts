import type { CommandPermissionSettingsPort } from 'src/domains/commands/ports';
import type { CommandAgentRunId } from '@app/schemas/commands';
import {
  snapshotCommandPermissionSettingsForRun,
  type CommandRunPermissionContext,
} from 'src/domains/commands/features/permission-settings';

const runPermissionBindings = new WeakMap<object, CommandRunPermissionContext>();

function freezeContext(context: CommandRunPermissionContext): CommandRunPermissionContext {
  if (context.status === 'available') {
    Object.freeze(context.snapshot);
  }
  return Object.freeze(context);
}

/**
 * 同一 RunHandle 会跨 awaiting_user/resume 存活，因此用 owner identity 绑定首次快照。
 * resume 若找不到旧绑定必须失败关闭；重新读取全局设置会让同一逻辑 run 中途提权。
 */
export function resolveCommandRunPermissionContext(input: {
  readonly runOwner: object;
  readonly executionKind: 'start' | 'resume';
  readonly rootAgentRunId: CommandAgentRunId;
  readonly settingsPort: CommandPermissionSettingsPort;
  readonly now?: () => number;
}): CommandRunPermissionContext {
  const existing = runPermissionBindings.get(input.runOwner);
  if (existing) {
    return existing;
  }

  if (input.executionKind === 'resume') {
    const unavailable = freezeContext({
      status: 'unavailable',
      code: 'permission_settings_unavailable',
      reason: 'run_snapshot_missing',
    });
    runPermissionBindings.set(input.runOwner, unavailable);
    return unavailable;
  }

  const context = freezeContext(snapshotCommandPermissionSettingsForRun({
    port: input.settingsPort,
    rootAgentRunId: input.rootAgentRunId,
    now: input.now,
  }));
  runPermissionBindings.set(input.runOwner, context);
  return context;
}
