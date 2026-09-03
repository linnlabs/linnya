import { describe, expect, it } from 'vitest';
import {
  CommandApprovalReplySubmissionV1Schema,
  parseCommandApprovalRequest,
  parseCommandApprovalSettlement,
  type CommandApprovalRequestV1,
} from '@app/schemas/commands';

import { createCommandApprovalHost } from '../orchestration/createCommandApprovalHost';

function request(index: number, rememberable = true): CommandApprovalRequestV1 {
  const identity = {
    conversation_id: `conversation-${index}`,
    agent_run_id: `run-${index}`,
    origin_tool_call_id: `shell-call-${index}`,
    command_execution_id: `command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2${index}`,
    owner_generation_id: 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
    created_at_ms: 1_000 + index,
  };
  return parseCommandApprovalRequest({
    protocol_version: 1,
    kind: 'command_approval_request',
    approval_request_id: `command_approval_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2${index}`,
    proposal: {
      protocol_version: 1,
      kind: 'shell_command_proposal',
      identity,
      command: `rm file-${index}.txt`,
      cwd: '/tmp/linnya-approval',
      permission: {
        protocol_version: 1,
        kind: 'command_permission_snapshot',
        identity,
        base_level: 'standard',
        effective_level: 'standard',
        grant_source: 'global_setting',
        internal_data_access: 'allowed',
      },
    },
    reasons: [{
      type: 'fixed_risk_rule',
      rule_id: 'macos.delete.file',
      category: 'delete',
    }],
    available_choices: rememberable
      ? ['allow_once', 'allow_for_conversation', 'deny']
      : ['allow_once', 'deny'],
    conversation_candidate: rememberable
      ? {
          token_prefix: ['rm', `file-${index}.txt`],
          matching_context: {
            platform: 'macos',
            shell_semantics_id: 'zsh',
            matcher_revision: 'simple-command-v1',
          },
        }
      : undefined,
    requested_at_ms: 1_100 + index,
  });
}

function settlement(value: CommandApprovalRequestV1) {
  return parseCommandApprovalSettlement({
    protocol_version: 1,
    kind: 'command_approval_settlement',
    approval_request_id: value.approval_request_id,
    proposal_identity: value.proposal.identity,
    settled_at_ms: 2_000,
    outcome: 'approved',
    choice: 'allow_once',
    permission: {
      ...value.proposal.permission,
      grant_source: 'allow_once',
    },
  });
}

function submission(input: {
  readonly pageTicket: string;
  readonly value: CommandApprovalRequestV1;
  readonly choice?: 'allow_once' | 'allow_for_conversation' | 'deny';
}) {
  return CommandApprovalReplySubmissionV1Schema.parse({
    protocol_version: 1,
    kind: 'command_approval_reply_submission',
    page_ticket: input.pageTicket,
    approval_request_id: input.value.approval_request_id,
    choice: input.choice ?? 'allow_once',
  });
}

describe('command approval pending host', () => {
  it('没有合法 renderer owner 时明确失败，不创建无界面等待', async () => {
    const host = createCommandApprovalHost();

    await expect(host.request({ request: request(1) })).resolves.toEqual({
      status: 'failed',
      reason: 'authorization_unavailable',
    });
  });

  it('单个 projection listener 抛错不打断 pending，其他观察者仍收到变化', async () => {
    const host = createCommandApprovalHost();
    host.openRendererPage(17);
    let observedChanges = 0;
    host.subscribe(() => {
      throw new Error('renderer delivery failed');
    });
    host.subscribe(() => {
      observedChanges += 1;
    });
    const approval = request(1);

    const response = host.request({ request: approval });
    expect(observedChanges).toBe(1);
    const current = host.openRendererPage(17);
    if (!current) return;
    expect(host.submitRendererReply({
      ownerId: 17,
      submission: submission({ pageTicket: current.page_ticket, value: approval }),
    })).toEqual({ success: true, status: 'accepted' });
    await expect(response).resolves.toMatchObject({ status: 'replied' });
    expect(observedChanges).toBe(2);
    await expect(host.settle(settlement(approval))).resolves.toBeUndefined();
    expect(observedChanges).toBe(3);
  });

  it('reply 只推进原请求到 processing，Commands settlement 后才移除', async () => {
    const host = createCommandApprovalHost({ createUuid: () => 'page-a' });
    const page = host.openRendererPage(7);
    expect(page).toBeDefined();
    if (!page) return;
    const approval = request(1);
    const response = host.request({ request: approval });

    const current = host.openRendererPage(7);
    expect(current?.pending[0]).toMatchObject({
      command: 'rm file-1.txt',
      status: 'awaiting_reply',
    });
    if (!current) return;
    expect(host.submitRendererReply({
      ownerId: 7,
      submission: submission({ pageTicket: current.page_ticket, value: approval }),
    })).toEqual({ success: true, status: 'accepted' });
    await expect(response).resolves.toMatchObject({
      status: 'replied',
      reply: { choice: 'allow_once' },
    });
    expect(host.openRendererPage(7)?.pending[0]?.status).toBe('processing');

    await host.settle(settlement(approval));
    expect(host.openRendererPage(7)?.pending).toEqual([]);
  });

  it('reload 轮换 page ticket，旧页面和旧 Enter 只能得到 invalid_page', async () => {
    let pageIndex = 0;
    const host = createCommandApprovalHost({
      createUuid: () => `page-${++pageIndex}`,
    });
    const oldPage = host.openRendererPage(9);
    if (!oldPage) return;
    const approval = request(2);
    const response = host.request({ request: approval });
    const newPage = host.openRendererPage(9);
    if (!newPage) return;

    expect(host.submitRendererReply({
      ownerId: 9,
      submission: submission({ pageTicket: oldPage.page_ticket, value: approval }),
    })).toEqual({ success: true, status: 'invalid_page' });
    expect(newPage.pending).toHaveLength(1);
    expect(host.submitRendererReply({
      ownerId: 9,
      submission: submission({ pageTicket: newPage.page_ticket, value: approval }),
    })).toEqual({ success: true, status: 'accepted' });
    await expect(response).resolves.toMatchObject({ status: 'replied' });

    expect(host.submitRendererReply({
      ownerId: 9,
      submission: submission({ pageTicket: newPage.page_ticket, value: approval }),
    })).toEqual({ success: true, status: 'stale' });
  });

  it('并发请求按 request identity 精准路由，不按当前弹窗猜目标', async () => {
    const host = createCommandApprovalHost();
    const page = host.openRendererPage(3);
    if (!page) return;
    const first = request(3);
    const second = request(4);
    const firstResponse = host.request({ request: first });
    const secondResponse = host.request({ request: second });
    const current = host.openRendererPage(3);
    if (!current) return;
    expect(current.pending).toHaveLength(2);

    host.submitRendererReply({
      ownerId: 3,
      submission: submission({
        pageTicket: current.page_ticket,
        value: second,
        choice: 'deny',
      }),
    });
    await expect(secondResponse).resolves.toMatchObject({
      status: 'replied',
      reply: { approval_request_id: second.approval_request_id, choice: 'deny' },
    });
    host.submitRendererReply({
      ownerId: 3,
      submission: submission({ pageTicket: current.page_ticket, value: first }),
    });
    await expect(firstResponse).resolves.toMatchObject({
      status: 'replied',
      reply: { approval_request_id: first.approval_request_id },
    });
  });

  it('只接受 request 明确提供的选择，复杂命令不能伪造对话级允许', async () => {
    const host = createCommandApprovalHost();
    const page = host.openRendererPage(13);
    if (!page) return;
    const simple = request(7, true);
    const complex = request(8, false);
    const simpleResponse = host.request({ request: simple });
    const complexResponse = host.request({ request: complex });
    const current = host.openRendererPage(13);
    if (!current) return;

    expect(host.submitRendererReply({
      ownerId: 13,
      submission: submission({
        pageTicket: current.page_ticket,
        value: simple,
        choice: 'allow_for_conversation',
      }),
    })).toEqual({ success: true, status: 'accepted' });
    await expect(simpleResponse).resolves.toMatchObject({
      status: 'replied',
      reply: { choice: 'allow_for_conversation' },
    });

    expect(host.submitRendererReply({
      ownerId: 13,
      submission: submission({
        pageTicket: current.page_ticket,
        value: complex,
        choice: 'allow_for_conversation',
      }),
    })).toEqual({ success: true, status: 'stale' });
    host.endOwner();
    await expect(complexResponse).resolves.toEqual({
      status: 'invalidated',
      reason: 'owner_ended',
    });
  });

  it('run abort 与 owner end 精准失效 pending，迟到允许永远不能获胜', async () => {
    const host = createCommandApprovalHost();
    const page = host.openRendererPage(5);
    if (!page) return;
    const abort = new AbortController();
    const aborted = request(5);
    const ended = request(6);
    const abortedResponse = host.request({ request: aborted, abortSignal: abort.signal });
    const endedResponse = host.request({ request: ended });
    abort.abort();
    await expect(abortedResponse).resolves.toEqual({
      status: 'invalidated',
      reason: 'run_cancelled',
    });
    expect(host.openRendererPage(5)?.pending.map(value => value.approval_request_id)).toEqual([
      ended.approval_request_id,
    ]);

    const latest = host.openRendererPage(5);
    if (!latest) return;
    host.endOwner();
    await expect(endedResponse).resolves.toEqual({
      status: 'invalidated',
      reason: 'owner_ended',
    });
    expect(host.submitRendererReply({
      ownerId: 5,
      submission: submission({ pageTicket: latest.page_ticket, value: ended }),
    })).toEqual({ success: true, status: 'invalid_page' });
    expect(host.openRendererPage(5)).toBeUndefined();
    await expect(host.request({ request: request(7) })).resolves.toMatchObject({ status: 'failed' });
  });
});
