import type Database from 'better-sqlite3';

import type { CommandExecutionAuditPort } from '../../../../../domains/audit/features/command-execution-audit';
import type { CommandPermissionSettingsPort } from '../../../../../domains/commands';
import type { CommandProductionScope } from '../../../adapters/commands/production-runtime';
import type { ConversationWorkDirectoryAdmissionPort } from '../../conversation-lifecycle';
import type { SandboxProductionScope } from './conversationRuntimeLifecycle';

export interface ConversationExecutionRuntimeScope {
  readonly command: CommandProductionScope;
  readonly sandbox: SandboxProductionScope;
  /** Agent run 与设置 UI 必须读取同一份三档命令权限 authority。 */
  readonly commandPermissionSettings: CommandPermissionSettingsPort;
}

export interface ConversationExecutionRuntimeCreateInput {
  readonly db: Database.Database;
  readonly conversationAdmission: ConversationWorkDirectoryAdmissionPort;
  readonly commandExecutionAudit: CommandExecutionAuditPort;
  readonly appDataRoot: string;
  readonly commandArtifactStorageRoot: string;
  resolveToolOutputBlobsDirectory(scope: {
    readonly conversationId: string;
    readonly instanceId: string;
  }): string;
}

/**
 * Conversation routes 只提交业务 owner，不选择 Electron Utility、headless Node 或桌面展示通道。
 * 物理 adapter 由当前 Backend owner 的 composition root 注入，避免 routes 形成第二套组合根。
 */
export interface ConversationExecutionRuntimeFactoryPort {
  create(input: ConversationExecutionRuntimeCreateInput): Promise<ConversationExecutionRuntimeScope>;
}
