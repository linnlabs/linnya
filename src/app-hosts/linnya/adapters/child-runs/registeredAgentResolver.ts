import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import type { childRuns } from '@linnlabs/linnkit/runtime-kernel';
import { toChildRunAgentConfig } from './childRunInvokerFactory';
import { findRegisteredAgentDefinitionByPromptKey } from 'src/app-hosts/linnya/agent-registry/agentDefinitionResolver';

export interface ResolvedRegisteredAgent {
  agentDefinition: AgentDefinition;
  agentConfig: childRuns.ChildRunAgentConfig;
}

export interface RegisteredAgentResolverPort {
  resolveByPromptKey(promptKey: string): ResolvedRegisteredAgent;
}

export class DefaultRegisteredAgentResolver implements RegisteredAgentResolverPort {
  resolveByPromptKey(promptKey: string): ResolvedRegisteredAgent {
    const agentDefinition = findRegisteredAgentDefinitionByPromptKey(promptKey);
    if (!agentDefinition) {
      throw new Error(`[registeredSubagentInvoker] unknown promptKey: ${promptKey}`);
    }
    return {
      agentDefinition,
      agentConfig: toChildRunAgentConfig(agentDefinition),
    };
  }
}

export function createDefaultRegisteredAgentResolver(): RegisteredAgentResolverPort {
  return new DefaultRegisteredAgentResolver();
}
