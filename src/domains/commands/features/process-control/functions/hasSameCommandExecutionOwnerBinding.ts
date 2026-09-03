import {
  hasSameCommandExecutionIdentity,
  type CommandExecutionOwnerBindingV1,
} from '@app/schemas/commands';

export function hasSameCommandExecutionOwnerBinding(
  expected: CommandExecutionOwnerBindingV1,
  actual: CommandExecutionOwnerBindingV1,
): boolean {
  return expected.process_handle === actual.process_handle
    && expected.mode === actual.mode
    && hasSameCommandExecutionIdentity(expected.identity, actual.identity);
}
