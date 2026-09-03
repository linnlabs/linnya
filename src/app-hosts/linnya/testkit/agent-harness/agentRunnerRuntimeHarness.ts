import type { RegisteredChildRunInvokerPort } from 'src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker';
import type { AgentRunnerRuntimePort } from 'src/app-hosts/linnya/adapters/flow/flow.agent-runner.service';
import { LinnyaRunCostCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import type { CommandPermissionSettingsPort } from 'src/domains/commands/ports';
import type { WorkspaceMutationPublisher } from 'src/features/workspace/definitions/workspaceMutationPublisher';

const unavailableChildRunInvoker: RegisteredChildRunInvokerPort = {
  async invoke() {
    throw new Error('This AgentRunner test did not assemble child-run execution');
  },
};

const defaultCommandPermissionSettings: CommandPermissionSettingsPort = {
  read: () => ({ status: 'missing' }),
  write: () => ({ status: 'written' }),
};

/** 让 Flow 测试显式声明其 child-run 能力，禁止退回进程全局默认值。 */
export function createAgentRunnerRuntimeHarness(options: {
  costCollector?: LinnyaRunCostCollector;
  registeredChildRunInvoker?: RegisteredChildRunInvokerPort;
  commandPermissionSettings?: CommandPermissionSettingsPort;
  workspaceMutationPublisher?: WorkspaceMutationPublisher;
  commandRuntime?: AgentRunnerRuntimePort['commandRuntime'];
} = {}): AgentRunnerRuntimePort {
  return {
    costCollector: options.costCollector ?? new LinnyaRunCostCollector(),
    registeredChildRunInvoker: options.registeredChildRunInvoker ?? unavailableChildRunInvoker,
    commandPermissionSettings:
      options.commandPermissionSettings ?? defaultCommandPermissionSettings,
    // 测试宿主显式声明不连接 Renderer；生产 composition 必须注入真实 presentation port。
    workspaceMutationPublisher: options.workspaceMutationPublisher ?? { publish: () => undefined },
    commandRuntime: options.commandRuntime ?? { kind: 'disabled' },
  };
}
