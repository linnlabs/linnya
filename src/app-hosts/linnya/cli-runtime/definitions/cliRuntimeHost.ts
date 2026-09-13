import type { Writable } from 'node:stream';
import type {
  CommandApprovalChoice,
  CommandApprovalPendingProjectionV1,
} from '@app/schemas/commands';

import type { AppServerProcessIdentity } from '../../../../infra/adapters/app-server-process';

export interface CliRuntimeHostInput {
  readonly developmentRoot: string;
  readonly applicationVersion: string;
  readonly workspaceRootOverride?: string;
  readonly apiPort: number;
  readonly qdrantPort: number;
  readonly processEnvironment: NodeJS.ProcessEnv;
  readonly stderrSink: Writable;
  readonly commandApprovalPrompt?: CliRuntimeCommandApprovalPromptPort;
  readonly onReady: (identity: AppServerProcessIdentity) => void;
}

/** 终端交互只选择 Backend 已声明的动作；命令、cwd 和权限均不可由 CLI 回传修改。 */
export interface CliRuntimeCommandApprovalPromptPort {
  requestChoice(
    approval: CommandApprovalPendingProjectionV1,
  ): Promise<CommandApprovalChoice>;
  close(): void;
}

export interface CliAppServerRuntime {
  start(): Promise<AppServerProcessIdentity>;
  waitForExit(): Promise<void>;
  shutdown(): Promise<void>;
}
