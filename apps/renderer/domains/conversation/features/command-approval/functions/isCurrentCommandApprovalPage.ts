import type {
  CommandApprovalPageSnapshotV1,
  CommandApprovalPageTicket,
} from '@app/schemas/commands';

export function isCurrentCommandApprovalPage(input: {
  readonly currentPageTicket: CommandApprovalPageTicket | undefined;
  readonly snapshot: CommandApprovalPageSnapshotV1;
}): boolean {
  return input.currentPageTicket === input.snapshot.page_ticket;
}
