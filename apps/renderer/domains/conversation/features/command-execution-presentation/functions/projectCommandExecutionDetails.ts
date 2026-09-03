import type {
  CommandOutputIncompleteReason,
} from '@app/schemas/commands';

import type { ConversationMessageKey } from '../../../definitions/conversationMessages';

const INCOMPLETE_REASON_KEYS: Readonly<
  Record<CommandOutputIncompleteReason, ConversationMessageKey>
> = {
  retained_window_omitted:
    'conversation.tool.command.outputIncomplete.retainedWindowOmitted',
  text_projection_failed:
    'conversation.tool.command.outputIncomplete.textProjectionFailed',
};

export function projectCommandIncompleteReasonKeys(
  reasons: readonly CommandOutputIncompleteReason[],
): readonly ConversationMessageKey[] {
  return reasons.map(reason => INCOMPLETE_REASON_KEYS[reason]);
}

export function projectCommandClipboardText(command: string, output: string): string {
  const commandLine = `$ ${command}`;
  return output.length === 0 ? commandLine : `${commandLine}\n${output}`;
}

export function formatCommandExecutionDuration(
  startedAtMs: number,
  settledAtMs: number,
  locale: string,
): string {
  const durationMs = settledAtMs - startedAtMs;
  if (durationMs < 1_000) {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'millisecond',
      unitDisplay: 'short',
      maximumFractionDigits: 0,
    }).format(durationMs);
  }
  if (durationMs < 60_000) {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(durationMs / 1_000);
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(durationMs / 60_000);
}
