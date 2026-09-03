import type {
  CommandRunnerInternalEnvironmentV1,
  PipeCommandLaunchSnapshotV1,
} from '@app/schemas/commands';
import type {
  CommandOutputArtifactOwner,
  CommandOutputArtifactPort,
  CommandRunnerProcessPort,
  PreparedCommandExecutionRuntime,
} from '../../../../../../domains/commands';
import type { PipeCommandOutputSettlement } from '../../output';
import type { PipeCommandTextSinkInput } from '../../output';

export const DEFAULT_COMMAND_RUNNER_START_HANDSHAKE_DEADLINE_MS = 10_000;
export const DEFAULT_COMMAND_RUNNER_CLOSE_DEADLINE_MS = 3_000;

export interface DisposablePipeCommandPreparedRuntimeInput {
  readonly launch: PipeCommandLaunchSnapshotV1;
  readonly artifactOwner: CommandOutputArtifactOwner;
  readonly artifactPort: CommandOutputArtifactPort;
  readonly runnerProcess: CommandRunnerProcessPort;
  /** 宿主短期凭证只进入 runner wire，不合并到 immutable launch 或审计。 */
  readonly internalEnvironment?: CommandRunnerInternalEnvironmentV1;
  /** encoding 只能取 immutable launch；调用方只注入 ToolOutput writer factory 与容量。 */
  readonly text: Omit<PipeCommandTextSinkInput, 'encoding' | 'observation'>;
  readonly now?: () => number;
  readonly startHandshakeDeadlineMs?: number;
  readonly closeDeadlineMs?: number;
  readonly onDiagnostic?: (bytes: Uint8Array) => void;
}

/**
 * Commands owner 只消费公共 runtime 合同；host 后续投影还必须取得同一次 output settlement，
 * 否则 artifact 不完整事实会在进入 Agent 文本层之前丢失。
 */
export interface DisposablePipeCommandPreparedRuntime extends PreparedCommandExecutionRuntime {
  readonly outputSettlement: Promise<PipeCommandOutputSettlement>;
}
