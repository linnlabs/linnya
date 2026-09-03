import type { CanonicalInferencePort } from '../ports';
import type { DefinedAgent, LinnkitQuickstartConfig } from './types';

function isCanonicalInferencePort(value: unknown): value is CanonicalInferencePort {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'stream') === 'function';
}

function isInferenceFactory(
  value: unknown
): value is () => CanonicalInferencePort | Promise<CanonicalInferencePort> {
  return typeof value === 'function';
}

function validateAgents(agents: readonly DefinedAgent[]): void {
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error('[linnkit] defineConfig requires at least one agent.');
  }
  const seen = new Set<string>();
  for (const agent of agents) {
    const id = agent?.spec?.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('[linnkit] defineConfig received an agent without spec.id.');
    }
    if (seen.has(id)) throw new Error(`[linnkit] duplicate agent id in config: ${id}`);
    seen.add(id);
  }
}

export function defineConfig(config: LinnkitQuickstartConfig): LinnkitQuickstartConfig {
  validateAgents(config.agents);
  if (!isCanonicalInferencePort(config.inference) && !isInferenceFactory(config.inference)) {
    throw new Error('[linnkit] defineConfig requires a canonical inference port or factory.');
  }
  return {
    agents: [...config.agents],
    inference: config.inference,
    defaultModelId: config.defaultModelId,
  };
}

export async function resolveConfiguredInference(
  config: LinnkitQuickstartConfig
): Promise<CanonicalInferencePort> {
  const inference = typeof config.inference === 'function'
    ? await config.inference()
    : config.inference;
  if (!isCanonicalInferencePort(inference)) {
    throw new Error('[linnkit] configured inference factory did not return a canonical port.');
  }
  return inference;
}
