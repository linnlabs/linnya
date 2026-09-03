import { AgentBuildPhase } from '../config';

const PROVIDER_PHASE_BY_NAME: Readonly<Record<string, AgentBuildPhase>> = {
  AgentCoreContextProvider: AgentBuildPhase.CORE_CONTEXT,
  AgentWorkingMemoryProvider: AgentBuildPhase.WORKING_MEMORY,
};

export function getAgentBuildPhaseByProviderName(providerName: string): AgentBuildPhase | null {
  return PROVIDER_PHASE_BY_NAME[providerName] ?? null;
}
