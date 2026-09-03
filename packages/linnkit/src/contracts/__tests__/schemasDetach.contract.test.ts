import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import * as agentContracts from '../index';

const movedRuntimeExports = [
  'AiMessage',
  'RuntimeEvent',
  'createFinalAnswerEvent',
  'createErrorEvent',
  'validateRuntimeEvent',
] as const;

const movedExecutionAndSseExports = [
  'DEFAULT_MAX_STEPS',
  'EventEnvelope',
  'ExecutionTraceContext',
  'SSEEvent',
  'SSEThoughtEvent',
  'SSEToolCallDecisionEvent',
  'SSEToolProcessEvent',
  'SSEToolOutputEvent',
  'SSEFinalAnswerChunkEvent',
  'SSEFinalAnswerEvent',
  'SSERequiresUserInteractionEvent',
  'SSEErrorEvent',
  'createSSEThoughtEvent',
  'createSSEToolCallDecisionEvent',
  'createSSEToolProcessEvent',
  'createSSEToolOutputEvent',
  'createSSEFinalAnswerChunkEvent',
  'createSSEFinalAnswerEvent',
  'createSSERequiresUserInteractionEvent',
  'createSSEErrorEvent',
] as const;

function walkProductionTypeScriptFiles(dir: URL): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = new URL(`${entry}`, dir);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      if (entry === '__tests__' || entry === 'docs') {
        continue;
      }
      files.push(...walkProductionTypeScriptFiles(new URL(`${entry}/`, dir)));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) {
      continue;
    }
    files.push(entryPath.pathname);
  }
  return files;
}

describe('contracts migration boundary', () => {
  it('keeps moved A-class runtime exports on src/agent/contracts', () => {
    for (const exportName of movedRuntimeExports) {
      expect(agentContracts).toHaveProperty(exportName);
    }
  });

  it('keeps moved execution and SSE protocol exports on linnkit/contracts', () => {
    for (const exportName of movedExecutionAndSseExports) {
      expect(agentContracts).toHaveProperty(exportName);
    }
  });

  it('keeps linnkit production code detached from @app/schemas', () => {
    const linnkitSrcRoot = new URL('../../', import.meta.url);
    const offenders = walkProductionTypeScriptFiles(linnkitSrcRoot)
      .filter((filePath) => readFileSync(filePath, 'utf8').includes('@app/schemas'))
      .map((filePath) => path.relative(linnkitSrcRoot.pathname, filePath))
      .sort();

    expect(offenders).toEqual([]);
  });
});
