import {
  CommandCardCancelResultV1Schema,
  CommandCardControlChangedEventV1Schema,
  CommandCardControlPageCloseResultV1Schema,
  CommandCardControlPageOpenResultV1Schema,
  CommandProtectedInputResultV1Schema,
  type CommandCardCancelResultV1,
  type CommandCardCancelSubmissionV1,
  type CommandCardControlChangedEventV1,
  type CommandCardControlPageCloseResultV1,
  type CommandCardControlPageOpenResultV1,
  type CommandCardControlPageTicket,
  type CommandProtectedInputResultV1,
  type CommandProtectedInputSubmissionV1,
} from '@app/schemas/commands';

export interface CommandCardControlGateway {
  openPage(conversationId: string): Promise<CommandCardControlPageOpenResultV1>;
  closePage(pageTicket: CommandCardControlPageTicket): Promise<CommandCardControlPageCloseResultV1>;
  cancel(submission: CommandCardCancelSubmissionV1): Promise<CommandCardCancelResultV1>;
  submitProtectedInput(
    submission: CommandProtectedInputSubmissionV1,
  ): Promise<CommandProtectedInputResultV1>;
  subscribe(listener: (event: CommandCardControlChangedEventV1) => void): () => void;
}

export const commandCardControlGateway: CommandCardControlGateway = {
  async openPage(conversationId) {
    return CommandCardControlPageOpenResultV1Schema.parse(
      await window.electronAPI.openCommandCardControlPage({ conversation_id: conversationId }),
    );
  },
  async closePage(pageTicket) {
    return CommandCardControlPageCloseResultV1Schema.parse(
      await window.electronAPI.closeCommandCardControlPage({ page_ticket: pageTicket }),
    );
  },
  async cancel(submission) {
    return CommandCardCancelResultV1Schema.parse(
      await window.electronAPI.cancelCommandFromCard(submission),
    );
  },
  async submitProtectedInput(submission) {
    return CommandProtectedInputResultV1Schema.parse(
      await window.electronAPI.submitCommandProtectedInput(submission),
    );
  },
  subscribe(listener) {
    return window.electronAPI.onCommandCardControlChanged((raw) => {
      const parsed = CommandCardControlChangedEventV1Schema.safeParse(raw);
      if (parsed.success) listener(parsed.data);
    });
  },
};
