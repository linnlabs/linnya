import {
  hasSameCommandExecutionIdentity,
  type CommandExecutionIdentity,
} from '@app/schemas/commands';
import type {
  CommandRunnerTerminalEvent,
  PtyCommandOutputProtocolFailure,
} from '../definitions/ptyCommandOutputSession';

export interface PtyCommandOutputReceipt {
  readonly nextSequence: number;
  readonly receivedBytes: number;
}

export type PtyCommandRunnerTerminalValidation =
  | { readonly status: 'accepted' }
  | { readonly status: 'protocol_failure'; readonly failure: PtyCommandOutputProtocolFailure };

/** runner 的来源声明只有与 host 实收 sequence/byte 完全一致时才能标记 transcript complete。 */
export function validatePtyCommandRunnerTerminal(input: {
  readonly expectedIdentity: CommandExecutionIdentity;
  readonly sourceStarted: boolean;
  readonly receipt: PtyCommandOutputReceipt;
  readonly event: CommandRunnerTerminalEvent;
}): PtyCommandRunnerTerminalValidation {
  if (!hasSameCommandExecutionIdentity(
    input.expectedIdentity,
    input.event.terminal.identity,
  )) {
    return { status: 'protocol_failure', failure: { code: 'identity_mismatch' } };
  }
  if (!input.sourceStarted) {
    if (
      input.event.terminal.process_exit.status === 'not_started'
      && input.event.output_sources === undefined
      && input.receipt.nextSequence === 0
    ) {
      return { status: 'accepted' };
    }
    return { status: 'protocol_failure', failure: { code: 'terminal_before_start_mismatch' } };
  }
  if (
    input.event.terminal.process_exit.status === 'not_started'
    || input.event.output_sources?.mode !== 'pty'
  ) {
    return { status: 'protocol_failure', failure: { code: 'terminal_source_mismatch' } };
  }
  const source = input.event.output_sources.terminal;
  if (
    source.next_sequence !== input.receipt.nextSequence
    || source.observed_bytes < input.receipt.receivedBytes
    || (
      source.source_completion === 'complete'
      && source.observed_bytes !== input.receipt.receivedBytes
    )
  ) {
    return { status: 'protocol_failure', failure: { code: 'terminal_source_mismatch' } };
  }
  return { status: 'accepted' };
}
