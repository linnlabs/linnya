import {
  CommandApprovalReplySubmissionV1Schema,
  type CommandApprovalChoice,
  type CommandApprovalPageSnapshotV1,
  type CommandApprovalRequestId,
} from '@app/schemas/commands';
import {
  commandApprovalGateway,
  type CommandApprovalGateway,
} from '../infrastructure/commandApprovalGateway';
import { isCurrentCommandApprovalPage } from '../functions/isCurrentCommandApprovalPage';
import { useCommandApprovalProjectionStore } from '../store/commandApprovalProjectionStore';

let mountedOwner: symbol | undefined;
let pageGeneration = 0;
let disposeCurrentPage = (): void => {};
let openingProjection: {
  readonly generation: number;
  readonly snapshots: Map<string, CommandApprovalPageSnapshotV1>;
} | undefined;

async function openCurrentPage(
  gateway: CommandApprovalGateway,
  owner: symbol,
): Promise<void> {
  const store = useCommandApprovalProjectionStore();
  const generation = ++pageGeneration;
  const snapshots = new Map<string, CommandApprovalPageSnapshotV1>();
  openingProjection = { generation, snapshots };
  try {
    const result = await gateway.openPage();
    if (mountedOwner !== owner || pageGeneration !== generation) return;
    if (!result.success) {
      store.pageUnavailable();
      return;
    }
    // CLI/另一页面可在 open 响应到达前完成审批；不能再用旧 pending 覆盖 changed。
    store.pageOpened(snapshots.get(result.snapshot.page_ticket) ?? result.snapshot);
  } catch {
    if (mountedOwner === owner && pageGeneration === generation) store.pageUnavailable();
  } finally {
    if (openingProjection?.generation === generation) openingProjection = undefined;
  }
}

export async function mountCommandApprovalPage(
  gateway: CommandApprovalGateway = commandApprovalGateway,
  signal?: AbortSignal,
): Promise<() => void> {
  disposeCurrentPage();
  const store = useCommandApprovalProjectionStore();
  const owner = Symbol('command-approval-page-owner');
  mountedOwner = owner;
  const unsubscribe = gateway.subscribe((event) => {
    if (mountedOwner !== owner) return;
    if (openingProjection?.generation === pageGeneration) {
      openingProjection.snapshots.set(event.snapshot.page_ticket, event.snapshot);
      return;
    }
    if (isCurrentCommandApprovalPage({
      currentPageTicket: store.snapshot?.page_ticket,
      snapshot: event.snapshot,
    })) {
      store.projectionChanged(event.snapshot);
    }
  });
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    signal?.removeEventListener('abort', release);
    unsubscribe();
    if (mountedOwner !== owner) return;
    mountedOwner = undefined;
    pageGeneration += 1;
    openingProjection = undefined;
    store.reset();
  };
  disposeCurrentPage = release;
  signal?.addEventListener('abort', release, { once: true });
  if (signal?.aborted) release();
  else await openCurrentPage(gateway, owner);
  return release;
}

export async function replyToCommandApproval(
  requestId: CommandApprovalRequestId,
  choice: CommandApprovalChoice,
  gateway: CommandApprovalGateway = commandApprovalGateway,
): Promise<void> {
  const store = useCommandApprovalProjectionStore();
  const snapshot = store.snapshot;
  const owner = mountedOwner;
  const pending = snapshot?.pending.find(value => value.approval_request_id === requestId);
  if (!owner || !snapshot || !pending || pending.status !== 'awaiting_reply') return;
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
    if (mountedOwner !== owner || store.snapshot?.page_ticket !== snapshot.page_ticket) return;
    if (result.status !== 'accepted') await openCurrentPage(gateway, owner);
  } catch {
    if (mountedOwner === owner && store.snapshot?.page_ticket === snapshot.page_ticket) {
      store.pageUnavailable();
    }
  } finally {
    if (mountedOwner === owner && store.snapshot?.page_ticket === snapshot.page_ticket) {
      store.replyFinished(pending.approval_request_id);
    }
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
