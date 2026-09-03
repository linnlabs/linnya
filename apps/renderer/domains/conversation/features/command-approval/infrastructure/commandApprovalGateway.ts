import {
  CommandApprovalChangedEventV1Schema,
  CommandApprovalPageOpenResultV1Schema,
  CommandApprovalReplyResultV1Schema,
  type CommandApprovalChangedEventV1,
  type CommandApprovalPageOpenResultV1,
  type CommandApprovalReplyResultV1,
  type CommandApprovalReplySubmissionV1,
} from '@app/schemas/commands';

export interface CommandApprovalGateway {
  openPage(): Promise<CommandApprovalPageOpenResultV1>;
  reply(submission: CommandApprovalReplySubmissionV1): Promise<CommandApprovalReplyResultV1>;
  subscribe(listener: (event: CommandApprovalChangedEventV1) => void): () => void;
}

export const commandApprovalGateway: CommandApprovalGateway = {
  async openPage() {
    return CommandApprovalPageOpenResultV1Schema.parse(
      await window.electronAPI.openCommandApprovalPage(),
    );
  },
  async reply(submission) {
    return CommandApprovalReplyResultV1Schema.parse(
      await window.electronAPI.replyToCommandApproval(submission),
    );
  },
  subscribe(listener) {
    return window.electronAPI.onCommandApprovalChanged((raw) => {
      const parsed = CommandApprovalChangedEventV1Schema.safeParse(raw);
      if (parsed.success) listener(parsed.data);
    });
  },
};
