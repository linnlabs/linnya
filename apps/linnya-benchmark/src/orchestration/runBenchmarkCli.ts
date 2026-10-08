import path from 'node:path';
import type { BenchmarkRegistry } from '../registry/createBenchmarkRegistry';
import type { BenchmarkConversationCliPort } from '../definitions/conversationCliPort';
import type { BenchmarkCliIo } from '../definitions/benchmarkCli';
import { BenchmarkUsageError } from '../definitions/benchmarkCli';
import type { BenchmarkReportPort } from '../definitions/benchmarkRun';
import { parseBenchmarkCliInvocation } from '../functions/parseBenchmarkCliInvocation';
import { resolveBenchmarkCase } from '../functions/resolveBenchmarkCase';
import { runBenchmarkCase } from './runBenchmarkCase';
import { runResearchWorkflow } from '../features/research-workflow/orchestration/runResearchWorkflow';
import type { ResearchWorkflowCliPort } from '../features/research-workflow/definitions/researchWorkflow';

interface RunBenchmarkCliOptions {
  readonly registry: BenchmarkRegistry;
  readonly conversationCli: BenchmarkConversationCliPort;
  readonly reports: BenchmarkReportPort;
  readonly researchCli?: ResearchWorkflowCliPort;
  readonly io?: BenchmarkCliIo;
}

export function benchmarkCliUsage(): string {
  return [
    'Linnya Agent Benchmark CLI',
    '',
    'Usage:',
    '  pnpm benchmark:agent list [--pretty]',
    '  pnpm benchmark:agent run <case-id> --project <workspace-project-id> --input key=value [--input key=value] [--output DIR] [--model ID] [--reasoning LEVEL] [--pretty]',
    '  pnpm benchmark:agent research-workflow --manifest FILE --output DIR [--resume-stage D0|R0|D1|R1]',
    '',
    'Benchmark runs always use the real Linnya conversation CLI and a running Linnya App.',
    '',
  ].join('\n');
}

function serialize(value: unknown, pretty: boolean): string {
  return `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`;
}

export async function runBenchmarkCli(
  argv: readonly string[],
  options: RunBenchmarkCliOptions
): Promise<number> {
  const io = options.io ?? {
    write: text => process.stdout.write(text),
    writeError: text => process.stderr.write(text),
  };
  try {
    const invocation = parseBenchmarkCliInvocation(argv);
    if (invocation.kind === 'help') {
      io.write(benchmarkCliUsage());
      return 0;
    }
    if (invocation.kind === 'list') {
      io.write(
        serialize(
          {
            schema_version: 1,
            cases: options.registry.list().map(definition => ({
              id: definition.id,
              revision: definition.revision,
              name: definition.name,
              description: definition.description,
              tags: definition.tags,
              agent_id: definition.agentId,
              timeout_ms: definition.timeoutMs,
              inputs: definition.inputs,
            })),
          },
          invocation.pretty
        )
      );
      return 0;
    }
    if (invocation.kind === 'research-workflow') {
      if (!options.researchCli) throw new Error('Research CLI adapter is not configured');
      const state = await runResearchWorkflow({
        manifestFile: path.resolve(invocation.manifestFile),
        output: path.resolve(invocation.output),
        resumeStage: invocation.resumeStage,
        cli: options.researchCli,
      });
      const completed =
        state.stages.length > 0 && state.stages.every(stage => stage.status === 'completed');
      io.write(
        serialize(
          {
            ok: completed,
            output: path.resolve(invocation.output),
            semantic_quality: 'not_evaluated',
            stages: state.stages.map(stage => ({
              id: stage.id,
              status: stage.status,
              receipt: stage.receipt,
              error: stage.error,
              outputCount: stage.outputs.length,
            })),
          },
          true
        )
      );
      return completed ? 0 : 3;
    }

    const definition = options.registry.get(invocation.caseId);
    if (!definition) {
      throw new BenchmarkUsageError(`Unknown Benchmark case: ${invocation.caseId}`);
    }
    const benchmark = await resolveBenchmarkCase(definition, invocation.inputs);
    const facts = await runBenchmarkCase(
      {
        benchmark,
        projectId: invocation.projectId,
        modelId: invocation.modelId,
        reasoningEffort: invocation.reasoningEffort,
      },
      { cli: options.conversationCli }
    );
    const location = await options.reports.write({
      benchmark,
      facts,
      outputRoot: invocation.outputRoot ? path.resolve(invocation.outputRoot) : undefined,
    });
    io.write(
      serialize(
        {
          schema_version: 1,
          ok: facts.outcome === 'completed',
          case_id: facts.benchmark.id,
          case_revision: facts.benchmark.revision,
          outcome: facts.outcome,
          conversation_id: facts.receipt?.conversation_id,
          run_id: facts.receipt?.run_id,
          duration_ms: facts.durationMs,
          report_directory: location.directory,
          facts_file: location.factsFile,
          report_file: location.reportFile,
        },
        invocation.pretty
      )
    );
    return facts.outcome === 'completed' ? 0 : 3;
  } catch (error: unknown) {
    const usage = error instanceof BenchmarkUsageError;
    io.writeError(
      serialize(
        {
          schema_version: 1,
          ok: false,
          error: {
            code: usage ? 'invalid_request' : 'internal_error',
            message: error instanceof Error ? error.message : 'Unexpected Benchmark CLI failure',
          },
        },
        false
      )
    );
    return usage ? 2 : 4;
  }
}
