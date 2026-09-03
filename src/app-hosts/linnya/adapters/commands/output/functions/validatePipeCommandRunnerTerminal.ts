import {
  hasSameCommandExecutionIdentity,
  type CommandExecutionIdentity,
  type CommandPipeOutputChannel,
} from '@app/schemas/commands';

import type {
  CommandRunnerTerminalEventV1,
  PipeCommandOutputProtocolFailure,
} from '../definitions/pipeCommandOutputSession';

type PipeOutputSources = Extract<
  NonNullable<CommandRunnerTerminalEventV1['output_sources']>,
  { readonly mode: 'pipe' }
>;

export interface PipeCommandOutputReceipt {
  readonly nextSequence: number;
  readonly receivedBytes: number;
}

export type PipeCommandRunnerTerminalValidation =
  | { readonly status: 'accepted' }
  | {
      readonly status: 'protocol_failure';
      readonly failure: PipeCommandOutputProtocolFailure;
    };

function validateSource(input: {
  readonly channel: CommandPipeOutputChannel;
  readonly receipt: PipeCommandOutputReceipt;
  readonly source: PipeOutputSources['stdout'];
}): PipeCommandRunnerTerminalValidation {
  if (
    input.source.next_sequence !== input.receipt.nextSequence
    || input.source.observed_bytes < input.receipt.receivedBytes
    || (
      input.source.source_completion === 'complete'
      && input.source.observed_bytes !== input.receipt.receivedBytes
    )
  ) {
    return {
      status: 'protocol_failure',
      failure: { code: 'terminal_source_mismatch', channel: input.channel },
    };
  }
  return { status: 'accepted' };
}

/**
 * runner 的 terminal 是来源声明，不是 host 实收事实。只有 identity、sequence 和 byte
 * 全部对上，host 才能把 complete 传给 artifact writer。
 */
export function validatePipeCommandRunnerTerminal(input: {
  readonly expectedIdentity: CommandExecutionIdentity;
  readonly sourceStarted: boolean;
  readonly stdout: PipeCommandOutputReceipt;
  readonly stderr: PipeCommandOutputReceipt;
  readonly event: CommandRunnerTerminalEventV1;
}): PipeCommandRunnerTerminalValidation {
  if (!hasSameCommandExecutionIdentity(
    input.expectedIdentity,
    input.event.terminal.identity,
  )) {
    return {
      status: 'protocol_failure',
      failure: { code: 'identity_mismatch' },
    };
  }

  if (!input.sourceStarted) {
    if (
      input.event.terminal.process_exit.status === 'not_started'
      && input.event.output_sources === undefined
      && input.stdout.nextSequence === 0
      && input.stderr.nextSequence === 0
    ) {
      return { status: 'accepted' };
    }
    return {
      status: 'protocol_failure',
      failure: { code: 'terminal_before_start_mismatch' },
    };
  }

  if (
    input.event.terminal.process_exit.status === 'not_started'
    || input.event.output_sources === undefined
    || input.event.output_sources.mode !== 'pipe'
  ) {
    return {
      status: 'protocol_failure',
      failure: { code: 'terminal_source_mismatch' },
    };
  }

  const stdout = validateSource({
    channel: 'stdout',
    receipt: input.stdout,
    source: input.event.output_sources.stdout,
  });
  if (stdout.status === 'protocol_failure') return stdout;

  return validateSource({
    channel: 'stderr',
    receipt: input.stderr,
    source: input.event.output_sources.stderr,
  });
}
