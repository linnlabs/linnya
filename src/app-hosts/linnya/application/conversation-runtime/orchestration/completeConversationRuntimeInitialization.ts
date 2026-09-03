import type {
  CommandAppOwnerLifecyclePort,
  CommandProductionScope,
} from '../../../adapters/commands/production-runtime';
import type {
  SandboxAppOwnerLifecyclePort,
  SandboxProductionScope,
} from '../definitions/conversationRuntimeLifecycle';
import { ConversationRuntimeInitializationError } from '../definitions/conversationRuntimeInitializationError';

/**
 * Commands 与 Profiled Code Sandbox 属于不同业务边界，但都必须在 routes 开放前成为
 * 同一个 App 生命周期的参与者。这个 App 级编排只固定装配顺序，不读取任一 domain 内部状态。
 */
export async function completeConversationRuntimeInitialization<T>(input: {
  readonly commandScope: CommandProductionScope;
  readonly sandboxScope: SandboxProductionScope;
  prepareRoutes(): Promise<T> | T;
  registerCommandOwner(lifecycle: CommandAppOwnerLifecyclePort): void;
  registerSandboxOwner(lifecycle: SandboxAppOwnerLifecyclePort): void;
  installSandboxRunner(scope: SandboxProductionScope): void;
}): Promise<T> {
  try {
    const preparedRoutes = await input.prepareRoutes();
    input.registerCommandOwner(input.commandScope);
    input.registerSandboxOwner(input.sandboxScope);
    // install-once 是不可逆提交点，只能位于全部可失败 route 准备和 owner 注册之后。
    input.installSandboxRunner(input.sandboxScope);
    return preparedRoutes;
  } catch (initializationFailure: unknown) {
    const cleanupFailures: unknown[] = [];
    for (const endOwner of [
      () => input.commandScope.endOwnerAndWait(),
      () => input.sandboxScope.endOwnerAndWait(),
    ]) {
      try {
        await endOwner();
      } catch (cleanupFailure: unknown) {
        cleanupFailures.push(cleanupFailure);
      }
    }
    throw new ConversationRuntimeInitializationError(
      initializationFailure,
      Object.freeze(cleanupFailures),
    );
  }
}
