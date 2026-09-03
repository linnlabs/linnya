import { DEFAULT_MAX_STEPS } from '@linnlabs/linnkit/contracts';
import {
  SubrunBatchArgsSchema,
  readSubrunBatchStructuredResult,
  type SubrunBatchArgs,
} from '@app/schemas';
import { runRegisteredSubagentsInParallel } from '../shared';
import {
  BaseTool,
  type ToolContext,
  type ToolParameterSchema,
} from 'src/tools/types';
import { buildSubrunBatchResult } from './functions/buildSubrunBatchResult';

export const SUBRUN_BATCH_TOOL_NAME = 'subrun_batch';

// child run 可以并行推理，但共享资源的真实写入必须由消费方 port 串行化。
const SUBRUN_BATCH_MAX_CONCURRENCY = 3;
const SUBRUN_BATCH_INHERIT_TURNS = 0;

function formatContractIssues(error: { issues: readonly { path: readonly (string | number)[]; message: string }[] }): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
    .join('; ');
}

function parseSubrunBatchArgs(args: Record<string, unknown>): SubrunBatchArgs {
  const result = SubrunBatchArgsSchema.safeParse(args);
  if (!result.success) {
    throw new Error(`subrun_batch: invalid arguments: ${formatContractIssues(result.error)}`);
  }
  return result.data;
}

function validateSubrunBatchArgs(args: Record<string, unknown>): { success: boolean; error?: string } {
  const result = SubrunBatchArgsSchema.safeParse(args);
  if (result.success) return { success: true };
  return {
    success: false,
    error: `subrun_batch: invalid arguments: ${formatContractIssues(result.error)}`,
  };
}

function requireExecutionModelId(context: ToolContext): string {
  const parentToolCallId = context.parentToolCallId?.trim();
  if (!parentToolCallId) {
    throw new Error('subrun_batch: parentToolCallId is required');
  }

  const modelId = context.modelId;
  if (!modelId) {
    throw new Error('subrun_batch: context.modelId is required');
  }

  return modelId;
}

export class SubrunBatchTool extends BaseTool {
  readonly name = SUBRUN_BATCH_TOOL_NAME;

  readonly description = '系统专用：按显式任务清单并发运行多个独立 child agents，并聚合其结果。';

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      worker_prompt_key: {
        type: 'string',
        description: '每个 child run 使用的已注册 Agent prompt key。',
      },
      subruns: {
        type: 'array',
        description: '按权威顺序执行和展示的独立任务清单。',
        items: {
          type: 'object',
          description: '一个拥有稳定业务 ID 与 subrun ID 的独立任务。',
          properties: {
            unit_id: {
              type: 'string',
              description: '调用方提供的稳定业务单元 ID。',
            },
            subrun_id: {
              type: 'string',
              description: '调用方提供的稳定 child run ID。',
            },
            description: {
              type: 'string',
              description: '供 UI 定位该任务的简短描述。',
            },
            prompt: {
              type: 'string',
              description: '交给 child agent 的完整、自包含任务说明。',
            },
          },
          required: ['unit_id', 'subrun_id', 'description', 'prompt'],
        },
      },
    },
    required: ['worker_prompt_key', 'subruns'],
    additionalProperties: false,
  };

  getExecutionSummary(output: string): string {
    try {
      const parsed: unknown = JSON.parse(output);
      const result = readSubrunBatchStructuredResult(parsed);
      if (!result) return '批量子任务已执行。';
      return `批量子任务：${result.data.succeeded}/${result.data.total} 完成。`;
    } catch {
      return '批量子任务已执行。';
    }
  }

  protected override validateArguments(args: Record<string, unknown>): { success: boolean; error?: string } {
    return validateSubrunBatchArgs(args);
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const input = parseSubrunBatchArgs(args);
    const modelId = requireExecutionModelId(context);

    const childResults = await runRegisteredSubagentsInParallel({
      context,
      maxConcurrency: SUBRUN_BATCH_MAX_CONCURRENCY,
      subruns: input.subruns.map((subrun) => ({
        subrunId: subrun.subrun_id,
        promptKey: input.worker_prompt_key,
        description: subrun.description,
        userMessage: [subrun.description, subrun.prompt].join('\n\n'),
        inheritTurns: SUBRUN_BATCH_INHERIT_TURNS,
        maxSteps: DEFAULT_MAX_STEPS,
        modelId,
        subrunSource: SUBRUN_BATCH_TOOL_NAME,
        subrunMetadata: {},
      })),
    });

    return JSON.stringify(buildSubrunBatchResult({
      subruns: input.subruns,
      childResults,
    }), null, 2);
  }
}
