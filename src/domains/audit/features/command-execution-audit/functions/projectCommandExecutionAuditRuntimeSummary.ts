import {
  CommandLaunchSnapshotV1Schema,
  type CommandLaunchSnapshotV1,
} from '@app/schemas/commands';

import {
  CommandExecutionAuditRuntimeSummarySchema,
  type CommandExecutionAuditRuntimeSummary,
} from '../definitions/commandExecutionAuditEvent';

/**
 * 完整 launch 含 argv 和环境正文，不能直接进入审计。这里逐字段挑选已经冻结的
 * Shell 来源和超时事实，未来 launch 新增字段时也不会被对象展开意外带入审计。
 */
export function projectCommandExecutionAuditRuntimeSummary(
  launch: CommandLaunchSnapshotV1,
): CommandExecutionAuditRuntimeSummary {
  const parsed = CommandLaunchSnapshotV1Schema.parse(launch);
  return CommandExecutionAuditRuntimeSummarySchema.parse({
    platform: parsed.shell.platform,
    shell_semantics_id: parsed.shell.shell_semantics_id,
    shell_version: parsed.shell.shell_version,
    snapshot_revision: parsed.shell.snapshot_revision,
    output_text_encoding: parsed.shell.output_text_encoding,
    command_invocation_profile_id: parsed.shell.command_invocation_profile_id,
    executable_path: parsed.shell.executable_path,
    hard_timeout_ms: parsed.hard_timeout_ms,
  });
}
