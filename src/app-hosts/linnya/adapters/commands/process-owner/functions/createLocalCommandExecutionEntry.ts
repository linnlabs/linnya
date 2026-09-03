import type { CommandExecutionOwnerBindingV1, CommandExecutionTerminalV1 } from '@app/schemas/commands';

import type { LocalCommandExecutionEntry } from '../definitions/localCommandExecutionEntry';

export function createLocalCommandExecutionEntry(
  binding: CommandExecutionOwnerBindingV1,
): LocalCommandExecutionEntry {
  let resolveSettlement: (terminal: CommandExecutionTerminalV1 | null) => void = () => {};
  const settlement = new Promise<CommandExecutionTerminalV1 | null>((resolve) => {
    resolveSettlement = resolve;
  });
  return {
    binding,
    state: 'reserved',
    interactionTail: Promise.resolve(),
    stdinState: 'open',
    handlePublished: false,
    startSettled: true,
    settlementPublished: false,
    settlement,
    resolveSettlement,
  };
}
