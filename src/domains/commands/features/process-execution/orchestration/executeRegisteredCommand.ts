import type {
  CommandProcessResult,
  RegisteredCommandExecutionRequest,
} from '../../../definitions/commandExecution';
import type { CommandDescriptorRegistryPort } from '../../../ports/commandDescriptorRegistryPort';
import type { CommandProcessPort } from '../../../ports/commandProcessPort';
import { resolveRegisteredCommandLaunch } from '../functions/resolveRegisteredCommandLaunch';

export async function executeRegisteredCommand(input: {
  readonly request: RegisteredCommandExecutionRequest;
  readonly registry: CommandDescriptorRegistryPort;
  readonly process: CommandProcessPort;
  readonly abortSignal?: AbortSignal;
}): Promise<CommandProcessResult> {
  const spec = await resolveRegisteredCommandLaunch({
    request: input.request,
    registry: input.registry,
  });
  return input.process.execute(spec, {
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  });
}
