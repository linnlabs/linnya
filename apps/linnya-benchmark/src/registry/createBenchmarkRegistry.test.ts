import { describe, expect, it } from 'vitest';
import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';
import { createBenchmarkRegistry } from './createBenchmarkRegistry';

function benchmark(id: string): BenchmarkCaseDefinition {
  return {
    id,
    revision: 1,
    name: id,
    description: 'test case',
    tags: ['test'],
    agentId: 'default_agent',
    reasoningEffort: 'medium',
    timeoutMs: 1000,
    promptTemplate: 'Read {{reference}}',
    inputs: [{ key: 'reference', label: 'Reference', kind: 'absolute_file', required: true }],
    interaction: { awaitingUser: 'manual', maxResponses: 0 },
    artifactExpectation: 'artifact',
    humanReview: [],
  };
}

describe('Benchmark registry', () => {
  it('按稳定 id 注册、查询并排序', () => {
    const registry = createBenchmarkRegistry([benchmark('case_b'), benchmark('case_a')]);
    expect(registry.get('case_a')?.name).toBe('case_a');
    expect(registry.list().map(item => item.id)).toEqual(['case_a', 'case_b']);
  });

  it('重复 id 明确失败，不静默覆盖', () => {
    expect(() => createBenchmarkRegistry([benchmark('same_case'), benchmark('same_case')]))
      .toThrow('Duplicate Benchmark case id: same_case');
  });
});
