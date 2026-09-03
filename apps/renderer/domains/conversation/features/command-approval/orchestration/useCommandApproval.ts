import {
  CommandApprovalReplySubmissionV1Schema,
  type CommandApprovalChoice,
  type CommandApprovalRequestId,
} from '@app/schemas/commands';
import {
  commandApprovalGateway,
  type CommandApprovalGateway,
} from '../infrastructure/commandApprovalGateway';
import { isCurrentCommandApprovalPage } from '../functions/isCurrentCommandApprovalPage';
import { useCommandApprovalProjectionStore } from '../store/commandApprovalProjectionStore';

async function openCurrentPage(
  gateway: CommandApprovalGateway,
): Promise<void> {
  const store = useCommandApprovalProjectionStore();
  try {
    const result = await gateway.openPage();
    if (!result.success) {
      store.pageUnavailable();
      return;
    }
    store.pageOpened(result.snapshot);
  } catch {
    store.pageUnavailable();
  }
}

export async function mountCommandApprovalPage(
  gateway: CommandApprovalGateway = commandApprovalGateway,
): Promise<() => void> {
  const store = useCommandApprovalProjectionStore();
  const unsubscribe = gateway.subscribe((event) => {
    if (isCurrentCommandApprovalPage({
      currentPageTicket: store.snapshot?.page_ticket,
      snapshot: event.snapshot,
    })) {
      store.projectionChanged(event.snapshot);
    }
  });
  await openCurrentPage(gateway);

  return () => {
    unsubscribe();
    store.reset();
  };
}

export async function replyToCommandApproval(
  requestId: CommandApprovalRequestId,
  choice: CommandApprovalChoice,
  gateway: CommandApprovalGateway = commandApprovalGateway,
): Promise<void> {
  const store = useCommandApprovalProjectionStore();
  const snapshot = store.snapshot;
  const pending = snapshot?.pending.find(value => value.approval_request_id === requestId);
  if (!snapshot || !pending || pending.status !== 'awaiting_reply') return;
  if (!pending.available_choices.includes(choice)) return;

  store.replyStarted(pending.approval_request_id);
  try {
    const result = await gateway.reply(CommandApprovalReplySubmissionV1Schema.parse({
      protocol_version: 1,
      kind: 'command_approval_reply_submission',
      page_ticket: snapshot.page_ticket,
      approval_request_id: pending.approval_request_id,
      choice,
    }));
    if (result.status !== 'accepted') await openCurrentPage(gateway);
  } catch {
    store.pageUnavailable();
  } finally {
    store.replyFinished(pending.approval_request_id);
  }
}

export async function replyToCurrentCommandApproval(
  choice: CommandApprovalChoice,
  gateway: CommandApprovalGateway = commandApprovalGateway,
): Promise<void> {
  const pending = useCommandApprovalProjectionStore().activePending;
  if (!pending) return;
  await replyToCommandApproval(pending.approval_request_id, choice, gateway);
}
