import type {
  MockInferencePreset,
  MockInferenceScript,
  MockInferenceScriptCatalog,
} from '../definitions/mockInferenceScript';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parsePreset(value: unknown, scriptName: string): MockInferencePreset {
  if (value === 'content' || value === 'tool_call') return value;
  throw new Error(`Mock inference script "${scriptName}" has an invalid preset.`);
}

function parseNumber(
  value: unknown,
  scriptName: string,
  field: 'delay_ms' | 'chunk_size',
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Mock inference script "${scriptName}" has an invalid ${field}.`);
  }
  if (field === 'delay_ms' && (value < 0 || value > 10_000)) {
    throw new Error(`Mock inference script "${scriptName}" has an out-of-range delay_ms.`);
  }
  if (field === 'chunk_size' && (value < 1 || value > 200)) {
    throw new Error(`Mock inference script "${scriptName}" has an out-of-range chunk_size.`);
  }
  return value;
}

function parseText(value: unknown, scriptName: string, field: 'thought' | 'content'): string {
  if (typeof value !== 'string') {
    throw new Error(`Mock inference script "${scriptName}" is missing ${field}.`);
  }
  return value;
}

function parseScript(name: string, value: unknown): MockInferenceScript {
  if (!isRecord(value)) {
    throw new Error(`Mock inference script "${name}" must be an object.`);
  }
  const tool = value.tool;
  if (tool !== undefined && typeof tool !== 'string') {
    throw new Error(`Mock inference script "${name}" has an invalid tool.`);
  }
  return {
    preset: parsePreset(value.preset, name),
    delay_ms: parseNumber(value.delay_ms, name, 'delay_ms'),
    chunk_size: parseNumber(value.chunk_size, name, 'chunk_size'),
    thought: parseText(value.thought, name, 'thought'),
    content: parseText(value.content, name, 'content'),
    ...(tool === undefined ? {} : { tool }),
  };
}

/**
 * checked-in mock 脚本是开发能力合同的一部分；损坏时应在模块加载阶段明确失败，
 * 不能静默退回另一份脚本并让调试结果失真。
 */
export function parseMockInferenceScriptCatalog(raw: unknown): MockInferenceScriptCatalog {
  if (!isRecord(raw) || !isRecord(raw.scripts)) {
    throw new Error('Mock inference script catalog is missing scripts.');
  }
  const scripts: Record<string, MockInferenceScript> = {};
  for (const [name, value] of Object.entries(raw.scripts)) {
    scripts[name] = parseScript(name, value);
  }
  if (Object.keys(scripts).length === 0) {
    throw new Error('Mock inference script catalog must contain at least one script.');
  }
  return { scripts };
}
