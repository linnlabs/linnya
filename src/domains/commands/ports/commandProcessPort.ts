import type {
  CommandLaunchSpec,
  CommandProcessResult,
} from '../definitions/commandExecution';

export interface CommandProcessPort {
  execute(
    spec: CommandLaunchSpec,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<CommandProcessResult>;
}
