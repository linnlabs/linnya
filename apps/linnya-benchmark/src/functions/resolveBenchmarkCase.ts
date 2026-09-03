import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  BenchmarkCaseDefinition,
  ResolvedBenchmarkCase,
} from '../definitions/benchmarkCase';
import { BenchmarkUsageError } from '../definitions/benchmarkCli';

export async function resolveBenchmarkCase(
  definition: BenchmarkCaseDefinition,
  suppliedInputs: Readonly<Record<string, string>>,
): Promise<ResolvedBenchmarkCase> {
  const knownInputs = new Set(definition.inputs.map(input => input.key));
  for (const key of Object.keys(suppliedInputs)) {
    if (!knownInputs.has(key)) {
      throw new BenchmarkUsageError(`Benchmark ${definition.id} does not declare input ${key}`);
    }
  }

  let prompt = definition.promptTemplate;
  const resolvedInputs: Record<string, string> = {};
  for (const input of definition.inputs) {
    const value = suppliedInputs[input.key];
    if (!value) {
      throw new BenchmarkUsageError(`Missing required input: ${input.key}`);
    }
    if (input.kind === 'absolute_file') {
      if (!path.isAbsolute(value)) {
        throw new BenchmarkUsageError(`Input ${input.key} must be an absolute file path`);
      }
      try {
        await access(value);
        if (!(await stat(value)).isFile()) {
          throw new BenchmarkUsageError(`Input ${input.key} is not a file: ${value}`);
        }
      } catch (error: unknown) {
        if (error instanceof BenchmarkUsageError) throw error;
        throw new BenchmarkUsageError(`Input ${input.key} is not readable: ${value}`);
      }
    }
    resolvedInputs[input.key] = value;
    prompt = prompt.split(`{{${input.key}}}`).join(value);
  }

  return { definition, prompt, inputs: resolvedInputs };
}
