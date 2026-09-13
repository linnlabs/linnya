import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

import type {
  CommandApprovalChoice,
  CommandApprovalPendingProjectionV1,
  CommandApprovalReason,
} from '@app/schemas/commands';

export interface TerminalCommandApprovalPrompt {
  requestChoice(
    approval: CommandApprovalPendingProjectionV1,
  ): Promise<CommandApprovalChoice>;
  close(): void;
}

/** stdout 保留给 CLI JSON；人工可读审批与问题统一走 stderr。 */
export function createTerminalCommandApprovalPrompt(input: {
  readonly input: Readable;
  readonly output: Writable;
  readonly onInterrupt: () => void;
}): TerminalCommandApprovalPrompt {
  const readline = createInterface({
    input: input.input,
    output: input.output,
    terminal: true,
  });
  let closed = false;
  // readline 会截获终端 Ctrl+C；把它交还给 Runtime lifecycle 的唯一 signal owner。
  readline.on('SIGINT', input.onInterrupt);

  const prompt: TerminalCommandApprovalPrompt = {
    async requestChoice(approval) {
      if (closed) throw new Error('CLI Runtime 终端审批输入已经关闭');
      input.output.write([
        '',
        '[Linnya command approval]',
        `Conversation: ${approval.conversation_id}`,
        `Working directory: ${approval.cwd}`,
        `Command: ${approval.command}`,
        `Reasons: ${approval.reasons.map(projectReason).join('; ')}`,
        ...(approval.conversation_token_prefix
          ? [`Conversation scope: ${JSON.stringify(approval.conversation_token_prefix)}`]
          : []),
      ].join('\n') + '\n');

      const choices = approval.available_choices;
      const labels = choices.map((choice, index) => `${index + 1}=${projectChoice(choice)}`);
      while (!closed) {
        const answer = (await readline.question(`Choose ${labels.join(', ')}: `)).trim();
        const numeric = Number(answer);
        const selected = Number.isInteger(numeric) && numeric >= 1
          ? choices[numeric - 1]
          : choices.find(choice => choice === answer);
        if (selected) return selected;
        input.output.write('Invalid choice. Enter the number or exact choice name.\n');
      }
      throw new Error('CLI Runtime 终端审批输入已经关闭');
    },
    close() {
      if (closed) return;
      closed = true;
      readline.off('SIGINT', input.onInterrupt);
      readline.close();
    },
  };
  return Object.freeze(prompt);
}

function projectReason(reason: CommandApprovalReason): string {
  switch (reason.type) {
    case 'permission_elevation':
      return `permission ${reason.from_level} -> ${reason.to_level}`;
    case 'fixed_risk_rule':
      return `${reason.category} (${reason.rule_id})`;
  }
}

function projectChoice(choice: CommandApprovalChoice): string {
  switch (choice) {
    case 'allow_once': return 'allow once';
    case 'allow_for_conversation': return 'allow for conversation';
    case 'deny': return 'deny';
  }
}
