import { randomUUID } from 'node:crypto';

import { parseShellCommandProposal, type CommandApprovalChoice, type CommandPermissionLevel } from '@app/schemas/commands';
import { describe, expect, it } from 'vitest';

import type { ConversationCommandApproval } from '../../../definitions/commandApproval';
import { authorizeCommandProposal } from '../orchestration/authorizeCommandProposal';

function fixture() {
  const remembered: ConversationCommandApproval[] = [];
  let prompts = 0;
  return {
    remembered,
    get prompts() { return prompts; },
    async authorize(input: {
      level?: CommandPermissionLevel;
      choice?: CommandApprovalChoice;
      command?: string;
      cwd?: string;
      requestStorage?: boolean;
      requestWrite?: boolean;
    } = {}) {
      const level = input.level ?? 'standard';
      const identity = {
        conversation_id: 'storage-conversation', agent_run_id: 'storage-run',
        origin_tool_call_id: `tool-${randomUUID()}`,
        command_execution_id: `command_execution_${randomUUID()}`,
        owner_generation_id: 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
        created_at_ms: 1_000,
      };
      const proposal = parseShellCommandProposal({
        protocol_version: 1, kind: 'shell_command_proposal', identity,
        command: input.command ?? 'cat /private/app/credentials.json',
        cwd: input.cwd ?? '/work/current',
        requests_internal_storage_access: input.requestStorage ?? true,
        permission: {
          protocol_version: 1, kind: 'command_permission_snapshot', identity,
          base_level: level, effective_level: level, grant_source: 'global_setting',
          internal_data_access: 'denied',
        },
      });
      return authorizeCommandProposal({
        proposal,
        permissionRequirement: { identity: proposal.identity, level: input.requestWrite ? 'standard' : 'selected_level' },
        platform: 'macos', shellSemanticsId: 'zsh',
        createApprovalRequestUuid: randomUUID, now: () => 1_100,
        approvals: {
          async listForConversation() { return remembered; },
          async remember(approval) {
            remembered.push(approval);
            return { status: 'created', approval };
          },
          async revoke(id) {
            const index = remembered.findIndex(approval => approval.approvalRequestId === id);
            if (index >= 0) remembered.splice(index, 1);
          },
        },
        approval: {
          async request({ request }) {
            prompts++;
            expect(request.available_choices).toContain('allow_for_conversation');
            return {
              status: 'replied',
              reply: {
                protocol_version: 1, kind: 'command_approval_reply',
                approval_request_id: request.approval_request_id, choice: input.choice ?? 'deny',
              },
            };
          },
          async settle() {},
        },
      });
    },
  };
}

describe('内部存储审批到授权的业务流程', () => {
  it.each(['read_only', 'standard'] as const)('%s：拒绝不放行，允许本次不保存，读取批准不升级写权限', async level => {
    const f = fixture();
    expect(await f.authorize({ level })).toMatchObject({ status: 'rejected', code: 'approval_denied' });
    expect(await f.authorize({ level, choice: 'allow_once' })).toMatchObject({
      status: 'authorized',
      permission: { effective_level: level, internal_storage_access: true, internal_data_access: 'denied' },
    });
    expect(f.remembered).toHaveLength(0);
    expect(await f.authorize({ level })).toMatchObject({ status: 'rejected' });
    expect(f.prompts).toBe(3);
  });

  it('保存规则只复用完整命令和 cwd；复杂脚本也不能追加或替换文本', async () => {
    const f = fixture();
    const command = 'node -e "require(\'fs\').readFileSync(\'/private/app/credentials.json\')"';
    expect(await f.authorize({ command, choice: 'allow_for_conversation' })).toMatchObject({ status: 'authorized' });
    expect(await f.authorize({ command })).toMatchObject({
      status: 'authorized', permission: { grant_source: 'conversation_approval', internal_storage_access: true },
    });
    expect(f.prompts).toBe(1);
    expect(await f.authorize({ command: `${command}; echo changed` })).toMatchObject({ status: 'rejected' });
    expect(await f.authorize({ command, cwd: '/work/other' })).toMatchObject({ status: 'rejected' });
  });

  it('普通写入批准不会授权内部存储，完全访问直接执行且不弹审批', async () => {
    const f = fixture();
    const command = 'cat /private/app/credentials.json';
    await f.authorize({ command, level: 'read_only', requestStorage: false, requestWrite: true, choice: 'allow_for_conversation' });
    expect(await f.authorize({ command })).toMatchObject({ status: 'rejected' });
    const promptCount = f.prompts;
    expect(await f.authorize({ level: 'full_access' })).toMatchObject({
      status: 'authorized', permission: { base_level: 'full_access', effective_level: 'full_access' },
    });
    expect(f.prompts).toBe(promptCount);
  });
});
