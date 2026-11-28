import type { Writable } from 'node:stream';
import type {
  CommandApprovalChoice,
  CommandApprovalPendingProjectionV1,
} from '@app/schemas/commands';

import type { AppServerProcessIdentity } from '../../../../infra/adapters/app-server-process';

export interface CliRuntimeHostInput {
  readonly developmentRoot: string;
  /** 显式 composition 选择的 Backend bundle；CLI 用户参数不开放该内部接缝。 */
  readonly mainBundleDirectory?: string;
  readonly applicationVersion: string;
  readonly workspaceRootOverride?: string;
  readonly apiPort: number;
  readonly qdrantPort: number;
  readonly processEnvironment: NodeJS.ProcessEnv;
  readonly stderrSink: Writable;
  readonly commandApprovalPrompt?: CliRuntimeCommandApprovalPromptPort;
  /**
   * 启动者显式放行“外部命令行代批命令”（`runtime start --allow-external-approval`）。
   * 评测与自动化用；缺省时批准只能在本运行时自己的终端提示里给出。
   */
  readonly allowExternalCommandApproval?: boolean;
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
  pauseForegroundRuns(): Promise<void>;
  shutdown(): Promise<void>;
}
