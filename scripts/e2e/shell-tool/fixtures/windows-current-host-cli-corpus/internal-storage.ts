import { createFileCredentialStorage } from '../../../../../src/infra/adapters/credential-storage/file/createFileCredentialStorage';
import assert from 'node:assert/strict';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  CommandAgentRunIdSchema, CommandOriginToolCallIdSchema,
  type CommandConversationId, type CommandPermissionLevel,
} from '@app/schemas/commands';
import type { CommandApprovalHost } from '../../../../../src/app-hosts/linnya/adapters/commands/approval-host';
import type { CommandProductionScope } from '../../../../../src/app-hosts/linnya/adapters/commands/production-runtime';
import { createCommandRunPermissionSnapshot } from '../../../../../src/domains/commands/features/permission-settings';

/** 经过正式 Shell 审批、utility、原生账户和输出存储；DOM 操作另由真实 Renderer 场景覆盖。 */
export async function verifyWindowsInternalStorage(input: {
  readonly scope: CommandProductionScope;
  readonly approvalHost: CommandApprovalHost;
  readonly conversationId: CommandConversationId;
  readonly appDataRoot: string;
}) {
  input.approvalHost.enableHostPresenter();
  let invocation = 0;
  function execute(command: string, level: CommandPermissionLevel) {
    const agentRunId = CommandAgentRunIdSchema.parse(`windows-internal-${++invocation}`);
    return input.scope.shellToolRuntime.executeShell({
      arguments: { command, initial_wait_ms: 30_000 },
      conversationId: input.conversationId, agentRunId,
      originToolCallId: CommandOriginToolCallIdSchema.parse(`windows-internal-${invocation}`),
      toolOutputInstanceId: 'default',
      commandRunPermission: {
        status: 'available',
        snapshot: createCommandRunPermissionSnapshot({
          settings: {
            schema_version: 1, kind: 'command_permission_settings', revision: 1,
            permission_level: level, internal_data_access: 'allowed', gui_control: 'denied',
            local_ipc_control: 'denied', process_lifecycle: 'terminate_with_run',
          },
          rootAgentRunId: agentRunId, capturedAtMs: Date.now(),
        }),
      },
    });
  }
  async function reply(choice: 'allow_once' | 'allow_for_conversation' | 'deny') {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const pending = input.approvalHost.readHostPresenter()?.pending[0];
      if (pending) {
        assert.equal(input.approvalHost.submitHostReply({
          approvalRequestId: pending.approval_request_id, choice,
        }).status, 'accepted');
        return;
      }
      await delay(10);
    }
    throw new Error('internal storage did not request approval');
  }
  for (const level of ['read_only', 'standard', 'full_access'] as const) {
    const secretPath = path.join(input.appDataRoot, level, 'config', 'credentials.json');
    await createFileCredentialStorage(secretPath).update('model-endpoints', new Map([['fixture', 'SYNTHETIC_INTERNAL_CREDENTIAL']]));
    const quoted = `'${secretPath.replace(/'/gu, "''")}'`;
    const command = `Get-Content -LiteralPath ${quoted}`;
    if (level !== 'full_access') {
      // 动态脚本不进入静态路径提示，仍必须由 OS 权限拒绝。
      const indirect = await execute(`$p=${quoted}; try { [IO.File]::ReadAllText($p); exit 91 } catch { [Console]::WriteLine('OS_DENIED'); exit 0 }`, level);
      assert(indirect.observation.includes('OS_DENIED'), JSON.stringify(indirect));
      assert(!indirect.observation.includes('SYNTHETIC_INTERNAL_CREDENTIAL'));
      const once = execute(command, level);
      await reply('allow_once');
      assert((await once).observation.includes('SYNTHETIC_INTERNAL_CREDENTIAL'));
      const next = execute(command, level);
      await reply('deny');
      assert.equal((await next).status, 'rejected');
      const remembered = execute(command, level);
      await reply('allow_for_conversation');
      assert((await remembered).observation.includes('SYNTHETIC_INTERNAL_CREDENTIAL'));
    }
    const direct = await execute(command, level);
    assert(direct.observation.includes('SYNTHETIC_INTERNAL_CREDENTIAL'));
    assert.equal(input.approvalHost.readHostPresenter()?.pending.length, 0);
  }
  return { levels: 3, indirectDenied: true, allowOnce: true, savedRule: true, fullAccess: true };
}
