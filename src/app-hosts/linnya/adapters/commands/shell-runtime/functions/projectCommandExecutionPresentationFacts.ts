import {
  CommandExecutionPresentationFactsV1Schema,
  type CommandExecutionPresentationFactsV1,
  type CommandPermissionSnapshotV1,
  type CommandPresentationPermissionSource,
} from '@app/schemas/commands';

/**
 * Host 只从授权终态与 runner/terminal 的真实时钟投影用户事实。消息创建时间描述的是
 * tool row 何时写入，不等于进程何时启动或结束，因此不能在 renderer 侧替代这里。
 */
export function projectCommandExecutionPresentationFacts(input: {
  readonly permission?: CommandPermissionSnapshotV1;
  readonly permissionSource?: CommandPresentationPermissionSource;
  readonly startedAtMs?: number;
  readonly settledAtMs?: number;
  readonly auditStatus?: 'complete' | 'incomplete';
}): CommandExecutionPresentationFactsV1 {
  if ((input.permission === undefined) !== (input.permissionSource === undefined)) {
    throw new Error('command presentation permission and source must be provided together');
  }
  const timing = input.startedAtMs === undefined
    ? {
        status: 'not_started' as const,
        settled_at_ms: input.settledAtMs,
      }
    : {
        status: 'started' as const,
        started_at_ms: input.startedAtMs,
        ...(input.settledAtMs === undefined ? {} : { settled_at_ms: input.settledAtMs }),
      };
  if (timing.status === 'not_started' && timing.settled_at_ms === undefined) {
    throw new Error('a command that has not started requires a settlement time');
  }
  return CommandExecutionPresentationFactsV1Schema.parse({
    protocol_version: 1,
    kind: 'command_execution_presentation_facts',
    timing,
    ...(input.permission && input.permissionSource
      ? {
          permission: {
            base_level: input.permission.base_level,
            effective_level: input.permission.effective_level,
            source: input.permissionSource,
            internal_data_access: input.permission.internal_data_access,
          },
        }
      : {}),
    ...(input.auditStatus ? { audit_status: input.auditStatus } : {}),
  });
}
