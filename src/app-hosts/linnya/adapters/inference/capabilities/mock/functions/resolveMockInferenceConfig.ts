import mockScriptCatalogJson from '../mock-scripts.json';
import type {
  MockInferencePreset,
  ResolvedMockInferenceConfig,
} from '../definitions/mockInferenceScript';
import { parseMockInferenceScriptCatalog } from './parseMockInferenceScriptCatalog';

const mockScriptCatalog = parseMockInferenceScriptCatalog(mockScriptCatalogJson);

function readPreset(url: URL, fallback: MockInferencePreset): MockInferencePreset {
  const value = url.searchParams.get('preset');
  if (value === null) return fallback;
  if (value === 'content' || value === 'tool_call') return value;
  throw new Error(`Unsupported mock inference preset: ${value}`);
}

function readInteger(
  url: URL,
  name: 'delay_ms' | 'chunk_size',
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Mock inference query parameter ${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

export function resolveMockInferenceConfig(baseUrl: string): ResolvedMockInferenceConfig {
  const url = new URL(baseUrl);
  if (url.protocol !== 'mock:') {
    throw new Error(`Mock inference capability cannot handle protocol: ${url.protocol}`);
  }
  const scriptName = url.searchParams.get('script') ?? 'content_fast';
  const script = mockScriptCatalog.scripts[scriptName];
  if (!script) {
    throw new Error(`Unknown mock inference script: ${scriptName}`);
  }
  const toolName = url.searchParams.get('tool') ?? script.tool;
  return {
    preset: readPreset(url, script.preset),
    delayMs: readInteger(url, 'delay_ms', script.delay_ms, 0, 10_000),
    chunkSize: readInteger(url, 'chunk_size', script.chunk_size, 1, 200),
    thought: url.searchParams.get('thought') ?? script.thought,
    content: url.searchParams.get('content') ?? script.content,
    ...(toolName === undefined || toolName.length === 0 ? {} : { toolName }),
  };
}

export function splitMockInferenceText(input: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < input.length; index += size) {
    chunks.push(input.slice(index, index + size));
  }
  return chunks;
}
