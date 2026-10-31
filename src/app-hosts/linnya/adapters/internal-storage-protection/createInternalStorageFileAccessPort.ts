import { randomUUID } from 'node:crypto';

import { CommandExecutionIdentitySchema, InternalFileReadProposalV1Schema } from '@app/schemas/commands';
import {
  authorizeInternalFileRead,
  createInitialCommandPermissionSnapshot,
  type CommandApprovalPort,
  type ConversationCommandApprovalPort,
} from 'src/domains/commands';
import type { ConversationWorkDirectoryAdmissionPort } from 'src/app-hosts/linnya/application/conversation-lifecycle';
import { PhysicalFileReadError } from 'src/app-hosts/linnya/application/file-read';
import type { InternalStorageFileAccessPort, InternalStoragePathPolicy } from './definitions/internalStorageAccess';

export function createInternalStorageFileAccessPort(input: {
  readonly policy: InternalStoragePathPolicy;
  readonly conversationAdmission: ConversationWorkDirectoryAdmissionPort;
  readonly platform: 'macos' | 'windows';
  readonly approvals: ConversationCommandApprovalPort;
  readonly approval: CommandApprovalPort;
  readonly readOwnerGenerationId: () => string;
}): InternalStorageFileAccessPort {
  return {
    async authorizeRead(request) {
      if (request.permission.status !== 'available') {
        throw new PhysicalFileReadError('READ_FILE_PERMISSION_UNAVAILABLE', '无法取得当前运行的文件访问权限。');
      }
      if (request.permission.snapshot.permission_level === 'full_access') return;
      // 审批不能占住对话删除的 admission gate；只在 gate 内取出路径事实。
      const conversationRoot = await input.conversationAdmission.withAdmission(
        { conversationId: request.conversationId }, directory => directory.absolutePath,
      );
      if (!await input.policy.isProtectedPath(request.absolutePath, conversationRoot)) return;
      const identity = CommandExecutionIdentitySchema.parse({
        conversation_id: request.conversationId, agent_run_id: request.agentRunId,
        origin_tool_call_id: request.toolCallId,
        command_execution_id: `command_execution_${randomUUID()}`,
        owner_generation_id: input.readOwnerGenerationId(), created_at_ms: Date.now(),
      });
      const proposal = InternalFileReadProposalV1Schema.parse({
        protocol_version: 1, kind: 'internal_file_read_proposal', identity,
        file_path: request.absolutePath, cwd: conversationRoot,
        requests_internal_storage_access: true,
        permission: createInitialCommandPermissionSnapshot({ runSnapshot: request.permission.snapshot, identity }),
      });
      const authorization = await authorizeInternalFileRead({
        proposal, platform: input.platform, approvals: input.approvals, approval: input.approval,
        createApprovalRequestUuid: randomUUID, now: Date.now,
        ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
      });
      if (authorization.status !== 'authorized') {
        throw new PhysicalFileReadError('READ_FILE_INTERNAL_STORAGE_ACCESS_DENIED', '未获准读取 Linnya 内部存储。');
      }
    },
  };
}
