import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as appSchemas from '../src/index';

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

describe('Linnkit contract ownership boundary', () => {
  it('不再从 Schemas 根入口暴露已经归还 Linnkit 的合同', () => {
    for (const exportName of [...movedRuntimeExports, ...movedExecutionAndSseExports]) {
      expect(appSchemas).not.toHaveProperty(exportName);
    }
  });

  it('不再登记已经删除的 Linnkit 合同 subpath', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { exports?: Record<string, unknown> };

    expect(packageJson.exports).toBeDefined();
    expect(packageJson.exports).not.toHaveProperty('./runtime-events');
    expect(packageJson.exports).not.toHaveProperty('./domain-models');
    expect(packageJson.exports).not.toHaveProperty('./view-models');
    expect(packageJson.exports).not.toHaveProperty('./runtime-models');
    expect(packageJson.exports).not.toHaveProperty('./sse-events');
  });

  it('不恢复已经删除的 Linnkit 合同源码面', () => {
    const schemasIndexUrl = new URL('../src/index.ts', import.meta.url);
    expect(readFileSync(schemasIndexUrl, 'utf8')).not.toContain("./view-models");
    expect(readFileSync(schemasIndexUrl, 'utf8')).not.toContain("./runtime-models");

    for (const relativePath of [
      '../src/domain-models.ts',
      '../src/runtime-events.ts',
      '../src/view-models.ts',
      '../src/runtime-models.ts',
    ]) {
      expect(existsSync(new URL(relativePath, import.meta.url))).toBe(false);
    }
  });
});
