import * as contextManager from '@linnlabs/linnkit/context-manager';
import { LINNYA_CONTEXT_POLICY_FALLBACK } from 'src/app-hosts/linnya/context-policies/defaultContextPolicy';

export interface DefaultAgentProviderRegistryOptions {
  customConfig?: Partial<contextManager.agentContext.AgentContextBuilderConfig>;
  providerOptions?: Pick<contextManager.AgentSpecProviderOptions, 'mustKeep'>;
}

export function createDefaultAgentProviderRegistry(
  options: DefaultAgentProviderRegistryOptions = {},
): contextManager.agentContext.ContextProviderRegistry {
  const registry = new contextManager.agentContext.ContextProviderRegistry();
  const providerOptions = resolveProviderOptions(options.providerOptions);

  registry.register(new contextManager.agentContext.AgentCoreContextProvider({
    mustKeepPolicy: providerOptions.mustKeep,
  }));
  registry.register(new contextManager.agentContext.AgentWorkingMemoryProvider(options.customConfig));

  return registry;
}

function resolveProviderOptions(
  options: Pick<contextManager.AgentSpecProviderOptions, 'mustKeep'> | undefined,
): Pick<contextManager.AgentSpecProviderOptions, 'mustKeep'> {
  const fallbackOptions = contextManager.contextPolicyToProviderOptions(
    contextManager.mergeContextPolicy({ hostFallback: LINNYA_CONTEXT_POLICY_FALLBACK }),
  );

  return {
    mustKeep: options?.mustKeep ?? fallbackOptions.mustKeep,
  };
}

export function getDefaultAgentProviderRegistry(): contextManager.agentContext.ContextProviderRegistry {
  return createDefaultAgentProviderRegistry();
}
