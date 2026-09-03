import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CommandApprovalChangedEventV1Schema,
  CommandApprovalPageOpenResultV1Schema,
  CommandApprovalPageSnapshotV1Schema,
  type CommandApprovalChangedEventV1,
  type CommandApprovalPageOpenResultV1,
  type CommandApprovalReplyResultV1,
  type CommandApprovalReplySubmissionV1,
} from '@app/schemas/commands';
import type { CommandApprovalGateway } from '../infrastructure/commandApprovalGateway';
import {
  mountCommandApprovalPage,
  replyToCommandApproval,
  replyToCurrentCommandApproval,
} from '../orchestration/useCommandApproval';
import { useCommandApprovalProjectionStore } from '../store/commandApprovalProjectionStore';

function snapshot(input: {
  readonly ticket: string;
  readonly requestIndex?: number;
  readonly status?: 'awaiting_reply' | 'processing';
  readonly rememberable?: boolean;
}) {
  const requestIndex = input.requestIndex ?? 1;
  return CommandApprovalPageSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'command_approval_page_snapshot',
    page_ticket: input.ticket,
    pending: [{
      protocol_version: 1,
      kind: 'command_approval_pending_projection',
      approval_request_id: `command_approval_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2${requestIndex}`,
      conversation_id: 'conversation-renderer',
      command: `rm file-${requestIndex}.txt`,
      cwd: '/tmp/renderer',
      reasons: [{ type: 'fixed_risk_rule', rule_id: 'delete.file', category: 'delete' }],
      available_choices: input.rememberable === false
        ? ['allow_once', 'deny']
        : ['allow_once', 'allow_for_conversation', 'deny'],
      ...(input.rememberable === false
        ? {}
        : { conversation_token_prefix: ['rm', `file-${requestIndex}.txt`] }),
      requested_at_ms: 1_000 + requestIndex,
      status: input.status ?? 'awaiting_reply',
    }],
  });
}

class MemoryCommandApprovalGateway implements CommandApprovalGateway {
  readonly openResults: CommandApprovalPageOpenResultV1[];
  readonly replies: CommandApprovalReplySubmissionV1[] = [];
  replyResult: CommandApprovalReplyResultV1 = { success: true, status: 'accepted' };
  listener: ((event: CommandApprovalChangedEventV1) => void) | undefined;
  unsubscribed = false;

  constructor(...openResults: CommandApprovalPageOpenResultV1[]) {
    this.openResults = [...openResults];
  }

  async openPage(): Promise<CommandApprovalPageOpenResultV1> {
    const result = this.openResults.shift();
    if (!result) throw new Error('missing open result');
    return result;
  }

  async reply(submission: CommandApprovalReplySubmissionV1) {
    this.replies.push(submission);
    return this.replyResult;
  }

  subscribe(listener: (event: CommandApprovalChangedEventV1) => void): () => void {
    this.listener = listener;
    return () => {
      this.unsubscribed = true;
      this.listener = undefined;
    };
  }

  emit(next: ReturnType<typeof snapshot>): void {
    this.listener?.(CommandApprovalChangedEventV1Schema.parse({
      protocol_version: 1,
      kind: 'command_approval_changed',
      snapshot: next,
    }));
  }
}

function opened(value: ReturnType<typeof snapshot>): CommandApprovalPageOpenResultV1 {
  return CommandApprovalPageOpenResultV1Schema.parse({ success: true, snapshot: value });
}

describe('command approval renderer orchestration', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('只接受当前 page ticket 的 projection，reload 旧 callback 不能覆盖新页面', async () => {
    const first = snapshot({ ticket: 'page-first' });
    const gateway = new MemoryCommandApprovalGateway(opened(first));
    const unmount = await mountCommandApprovalPage(gateway);
    const store = useCommandApprovalProjectionStore();
    expect(store.activePending?.command).toBe('rm file-1.txt');

    gateway.emit(snapshot({ ticket: 'page-stale', requestIndex: 2 }));
    expect(store.activePending?.command).toBe('rm file-1.txt');
    gateway.emit(snapshot({ ticket: 'page-first', requestIndex: 3 }));
    expect(store.activePending?.command).toBe('rm file-3.txt');

    unmount();
    expect(gateway.unsubscribed).toBe(true);
    expect(store.pageState).toBe('idle');
  });

  it('提交内容严格只有 ticket/request/choice，不在 renderer 复制 proposal 或批准记忆', async () => {
    const current = snapshot({ ticket: 'page-current' });
    const gateway = new MemoryCommandApprovalGateway(opened(current));
    await mountCommandApprovalPage(gateway);

    await replyToCurrentCommandApproval('allow_for_conversation', gateway);
    expect(gateway.replies).toEqual([{
      protocol_version: 1,
      kind: 'command_approval_reply_submission',
      page_ticket: current.page_ticket,
      approval_request_id: current.pending[0]?.approval_request_id,
      choice: 'allow_for_conversation',
    }]);
  });

  it('多个对话同时等待时按 request identity 回复，不把当前对话的选择发给队首请求', async () => {
    const firstPage = snapshot({ ticket: 'page-concurrent', requestIndex: 1 });
    const secondPage = snapshot({ ticket: 'page-concurrent', requestIndex: 2 });
    const firstPending = firstPage.pending[0];
    const secondPending = secondPage.pending[0];
    if (!firstPending || !secondPending) throw new Error('expected pending approval fixtures');
    const concurrent = CommandApprovalPageSnapshotV1Schema.parse({
      ...firstPage,
      pending: [
        { ...firstPending, conversation_id: 'conversation-other' },
        { ...secondPending, conversation_id: 'conversation-current' },
      ],
    });
    const gateway = new MemoryCommandApprovalGateway(opened(concurrent));
    await mountCommandApprovalPage(gateway);

    await replyToCommandApproval(secondPending.approval_request_id, 'allow_once', gateway);

    expect(gateway.replies).toEqual([{
      protocol_version: 1,
      kind: 'command_approval_reply_submission',
      page_ticket: concurrent.page_ticket,
      approval_request_id: secondPending.approval_request_id,
      choice: 'allow_once',
    }]);
  });

  it('host 返回 stale/invalid_page 时重新开页，旧 Enter 不会被当作成功', async () => {
    const oldPage = snapshot({ ticket: 'page-old' });
    const freshPage = snapshot({ ticket: 'page-fresh', requestIndex: 2 });
    const gateway = new MemoryCommandApprovalGateway(opened(oldPage), opened(freshPage));
    gateway.replyResult = { success: true, status: 'invalid_page' };
    await mountCommandApprovalPage(gateway);

    await replyToCurrentCommandApproval('allow_once', gateway);
    const store = useCommandApprovalProjectionStore();
    expect(store.snapshot?.page_ticket).toBe(freshPage.page_ticket);
    expect(store.activePending?.approval_request_id).toBe(
      freshPage.pending[0]?.approval_request_id,
    );
  });

  it('processing projection 不再发送第二次回复，复杂命令不能自行增加对话允许', async () => {
    const processing = snapshot({
      ticket: 'page-processing',
      status: 'processing',
      rememberable: false,
    });
    const gateway = new MemoryCommandApprovalGateway(opened(processing));
    await mountCommandApprovalPage(gateway);

    await replyToCurrentCommandApproval('allow_once', gateway);
    await replyToCurrentCommandApproval('allow_for_conversation', gateway);
    expect(gateway.replies).toEqual([]);
  });
});
