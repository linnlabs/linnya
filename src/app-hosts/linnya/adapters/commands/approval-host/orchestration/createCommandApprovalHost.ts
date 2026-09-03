import { randomUUID } from 'node:crypto';

import {
  CommandApprovalPageSnapshotV1Schema,
  CommandApprovalPageTicketSchema,
  CommandApprovalReplyV1Schema,
  hasSameCommandExecutionIdentity,
  type CommandApprovalPageTicket,
  type CommandApprovalRequestV1,
  type CommandApprovalSettlementV1,
} from '@app/schemas/commands';
import type { CommandApprovalResponse as DomainCommandApprovalResponse } from 'src/domains/commands';
import type {
  CommandApprovalRendererOwnerId,
  CommandApprovalHost,
} from '../definitions/commandApprovalHost';
import { projectCommandApprovalPending } from '../functions/projectCommandApprovalPending';
import { isCommandApprovalChoiceAvailable } from '../functions/isCommandApprovalChoiceAvailable';

type PendingStatus = 'awaiting_reply' | 'processing' | 'invalidated';

interface PendingApproval {
  readonly request: CommandApprovalRequestV1;
  readonly resolve: (response: DomainCommandApprovalResponse) => void;
  readonly removeAbortListener: () => void;
  status: PendingStatus;
  responseDelivered: boolean;
}

function createPageTicket(createUuid: () => string): CommandApprovalPageTicket {
  return CommandApprovalPageTicketSchema.parse(`command_approval_page_${createUuid()}`);
}

/**
 * App Server 是 pending 审批的唯一事实来源。renderer reload 只轮换页面通行证，
 * 不结束业务请求；run/App owner 的失效则直接让等待中的原 tool call 得到唯一终态。
 */
export function createCommandApprovalHost(input: {
  readonly createUuid?: () => string;
} = {}): CommandApprovalHost {
  const createUuid = input.createUuid ?? randomUUID;
  const pending = new Map<string, PendingApproval>();
  const rendererPages = new Map<CommandApprovalRendererOwnerId, CommandApprovalPageTicket>();
  const listeners = new Set<() => void>();
  let ownerActive = true;

  const notify = (): void => {
    // UI projection 是审批事实的观察者。renderer 发送竞态或单个观察者故障不能回滚
    // 已插入 pending、用户回复或 settlement，也不能阻断其他合法页面观察变化。
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        continue;
      }
    }
  };

  const projectPage = (pageTicket: CommandApprovalPageTicket) => (
    CommandApprovalPageSnapshotV1Schema.parse({
      protocol_version: 1,
      kind: 'command_approval_page_snapshot',
      page_ticket: pageTicket,
      pending: Array.from(pending.values())
        .sort((left, right) => left.request.requested_at_ms - right.request.requested_at_ms)
        .flatMap(entry => entry.status === 'invalidated'
          ? []
          : [projectCommandApprovalPending({
              request: entry.request,
              status: entry.status,
            })]),
    })
  );

  const invalidatePending = (
    entry: PendingApproval,
    reason: 'run_cancelled' | 'owner_ended',
  ): void => {
    if (entry.status === 'invalidated') return;
    entry.status = 'invalidated';
    if (!entry.responseDelivered) {
      entry.responseDelivered = true;
      entry.resolve({ status: 'invalidated', reason });
    }
  };

  const host: CommandApprovalHost = {
    async request({ request, abortSignal }) {
      if (abortSignal?.aborted) {
        return { status: 'invalidated', reason: 'run_cancelled' };
      }
      if (!ownerActive || rendererPages.size === 0 || pending.has(request.approval_request_id)) {
        return { status: 'failed', reason: 'authorization_unavailable' };
      }

      return new Promise<DomainCommandApprovalResponse>((resolve) => {
        let entry: PendingApproval;
        const abort = (): void => {
          invalidatePending(entry, 'run_cancelled');
          notify();
        };
        entry = {
          request,
          resolve,
          status: 'awaiting_reply',
          responseDelivered: false,
          removeAbortListener: () => abortSignal?.removeEventListener('abort', abort),
        };
        pending.set(request.approval_request_id, entry);
        abortSignal?.addEventListener('abort', abort, { once: true });
        notify();
      });
    },

    async settle(settlement: CommandApprovalSettlementV1) {
      const entry = pending.get(settlement.approval_request_id);
      if (!entry) return;
      if (!hasSameCommandExecutionIdentity(
        entry.request.proposal.identity,
        settlement.proposal_identity,
      )) {
        throw new Error('Command approval settlement does not match the pending proposal.');
      }
      entry.removeAbortListener();
      pending.delete(settlement.approval_request_id);
      notify();
    },

    openRendererPage(ownerId) {
      if (!ownerActive) return undefined;
      const pageTicket = createPageTicket(createUuid);
      rendererPages.set(ownerId, pageTicket);
      return projectPage(pageTicket);
    },

    readRendererPage({ ownerId, pageTicket }) {
      if (!ownerActive || rendererPages.get(ownerId) !== pageTicket) return undefined;
      return projectPage(pageTicket);
    },

    invalidateRendererPage({ ownerId, pageTicket }) {
      if (rendererPages.get(ownerId) !== pageTicket) return;
      rendererPages.delete(ownerId);
    },

    submitRendererReply({ ownerId, submission }) {
      if (!ownerActive || rendererPages.get(ownerId) !== submission.page_ticket) {
        return { success: true, status: 'invalid_page' };
      }
      const entry = pending.get(submission.approval_request_id);
      if (
        !entry
        || entry.status !== 'awaiting_reply'
        || !isCommandApprovalChoiceAvailable({
          request: entry.request,
          choice: submission.choice,
        })
      ) {
        return { success: true, status: 'stale' };
      }

      entry.status = 'processing';
      entry.responseDelivered = true;
      entry.resolve({
        status: 'replied',
        reply: CommandApprovalReplyV1Schema.parse({
          protocol_version: 1,
          kind: 'command_approval_reply',
          approval_request_id: submission.approval_request_id,
          choice: submission.choice,
        }),
      });
      notify();
      return { success: true, status: 'accepted' };
    },

    endOwner() {
      if (!ownerActive) return;
      ownerActive = false;
      rendererPages.clear();
      for (const entry of pending.values()) {
        entry.removeAbortListener();
        invalidatePending(entry, 'owner_ended');
      }
      pending.clear();
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return Object.freeze(host);
}
