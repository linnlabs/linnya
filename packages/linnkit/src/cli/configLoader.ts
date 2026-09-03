import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { DefinedAgent, LinnkitQuickstartConfig } from '../quickstart';
import { defineConfig } from '../quickstart';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDefaultExport(moduleValue: unknown): unknown {
  if (isRecord(moduleValue) && 'default' in moduleValue) {
    return moduleValue.default;
  }
  return moduleValue;
}

function isConfiguredInference(value: unknown): value is LinnkitQuickstartConfig['inference'] {
  if (typeof value === 'function') {
    return true;
  }
  return (
    isRecord(value) &&
    typeof value.stream === 'function'
  );
}

function isDefinedAgent(value: unknown): value is DefinedAgent {
  if (!isRecord(value) || !isRecord(value.spec)) return false;
  return typeof value.spec.id === 'string'
    && value.spec.id.trim().length > 0
    && typeof value.systemPrompt === 'string'
    && Array.isArray(value.tools)
    && (value.modelId === undefined || typeof value.modelId === 'string');
}

function readConfig(value: Record<string, unknown>, absolutePath: string): LinnkitQuickstartConfig {
  const agents = value.agents;
  if (!Array.isArray(agents) || !agents.every(isDefinedAgent)) {
    throw new Error(`[linnkit] config.agents must contain defined agents: ${absolutePath}`);
  }
  const inference = value.inference;
  if (!isConfiguredInference(inference)) {
    throw new Error(`[linnkit] config.inference must be a canonical port or factory: ${absolutePath}`);
  }
  const defaultModelId = value.defaultModelId;
  if (defaultModelId !== undefined && typeof defaultModelId !== 'string') {
    throw new Error(`[linnkit] config.defaultModelId must be a string when provided: ${absolutePath}`);
  }
  return {
    agents,
    inference,
    defaultModelId,
  };
}

export async function loadConfig(
  configPath: string,
  cwd: string,
): Promise<LinnkitQuickstartConfig> {
  const absolutePath = resolve(cwd, configPath);
  const moduleUrl = pathToFileURL(absolutePath);
  moduleUrl.searchParams.set('t', String(Date.now()));
  const loaded = await import(moduleUrl.href);
  const config = readDefaultExport(loaded);
  if (!isRecord(config)) {
    throw new Error(`[linnkit] config must export an object: ${absolutePath}`);
  }
  return defineConfig(readConfig(config, absolutePath));
}
