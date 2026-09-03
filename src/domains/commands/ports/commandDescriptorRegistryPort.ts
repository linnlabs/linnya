import type { RegisteredCommandDescriptor } from '../definitions/commandExecution';

export interface CommandDescriptorRegistryPort {
  get(commandId: string): RegisteredCommandDescriptor | undefined;
}
