import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';

export interface BenchmarkRegistry {
  readonly get: (id: string) => BenchmarkCaseDefinition | undefined;
  readonly list: () => readonly BenchmarkCaseDefinition[];
}

function assertBenchmarkCase(definition: BenchmarkCaseDefinition): void {
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(definition.id)) {
    throw new Error(`Invalid Benchmark case id: ${definition.id}`);
  }
  if (!Number.isSafeInteger(definition.revision) || definition.revision < 1) {
    throw new Error(`Benchmark case ${definition.id} must have a positive integer revision`);
  }
  const inputKeys = new Set<string>();
  for (const input of definition.inputs) {
    if (inputKeys.has(input.key)) {
      throw new Error(`Benchmark case ${definition.id} declares duplicate input ${input.key}`);
    }
    inputKeys.add(input.key);
    if (!definition.promptTemplate.includes(`{{${input.key}}}`)) {
      throw new Error(`Benchmark case ${definition.id} does not use input ${input.key}`);
    }
  }
}

export function createBenchmarkRegistry(
  definitions: readonly BenchmarkCaseDefinition[],
): BenchmarkRegistry {
  const cases = new Map<string, BenchmarkCaseDefinition>();
  for (const definition of definitions) {
    assertBenchmarkCase(definition);
    if (cases.has(definition.id)) {
      throw new Error(`Duplicate Benchmark case id: ${definition.id}`);
    }
    cases.set(definition.id, definition);
  }
  return {
    get: id => cases.get(id),
    list: () => [...cases.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}
