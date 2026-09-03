import { BenchmarkUsageError, type BenchmarkCliInvocation } from '../definitions/benchmarkCli';

const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
type ReasoningEffort = (typeof REASONING_LEVELS)[number];

function parseReasoning(value: string): ReasoningEffort {
  const effort = REASONING_LEVELS.find(candidate => candidate === value);
  if (!effort) throw new BenchmarkUsageError(`Invalid reasoning effort: ${value}`);
  return effort;
}

function parseInputs(values: readonly string[]): Readonly<Record<string, string>> {
  const inputs: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf('=');
    if (separator <= 0 || separator === value.length - 1) {
      throw new BenchmarkUsageError('--input must use key=value');
    }
    const key = value.slice(0, separator);
    if (Object.hasOwn(inputs, key)) {
      throw new BenchmarkUsageError(`Duplicate --input key: ${key}`);
    }
    inputs[key] = value.slice(separator + 1);
  }
  return inputs;
}

export function parseBenchmarkCliInvocation(argv: readonly string[]): BenchmarkCliInvocation {
  if (argv.length === 0 || argv[0] === 'help' || argv.includes('--help')) return { kind: 'help' };
  const command = argv[0];
  if (command === 'list') {
    const extras = argv.slice(1).filter(value => value !== '--pretty');
    if (extras.length > 0) throw new BenchmarkUsageError(`Unknown list argument: ${extras[0]}`);
    return { kind: 'list', pretty: argv.includes('--pretty') };
  }
  if (command !== 'run') throw new BenchmarkUsageError(`Unknown command: ${command}`);

  const caseId = argv[1];
  if (!caseId || caseId.startsWith('--')) {
    throw new BenchmarkUsageError('run requires a Benchmark case id');
  }
  let projectId: string | undefined;
  let outputRoot: string | undefined;
  let modelId: string | undefined;
  let reasoningEffort: ReasoningEffort | undefined;
  let pretty = false;
  const inputValues: string[] = [];
  for (let index = 2; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--pretty') {
      pretty = true;
      continue;
    }
    if (!option || !['--project', '--input', '--output', '--model', '--reasoning'].includes(option)) {
      throw new BenchmarkUsageError(`Unknown run argument: ${option ?? ''}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new BenchmarkUsageError(`${option} requires a value`);
    }
    index += 1;
    switch (option) {
      case '--project': projectId = value; break;
      case '--input': inputValues.push(value); break;
      case '--output': outputRoot = value; break;
      case '--model': modelId = value; break;
      case '--reasoning': reasoningEffort = parseReasoning(value); break;
    }
  }
  if (!projectId) throw new BenchmarkUsageError('run requires --project <workspace-project-id>');
  return {
    kind: 'run',
    caseId,
    projectId,
    inputs: parseInputs(inputValues),
    outputRoot,
    modelId,
    reasoningEffort,
    pretty,
  };
}
