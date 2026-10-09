import { vi } from 'vitest';
import { z } from 'zod';
import type { ConversationNextRequest } from '@app/schemas';
import type { ScriptedLlmTurn } from '@linnlabs/linnkit/testkit';
import { BaseTool, type ToolContext } from 'src/tools/types';
import { runRegisteredSubagent } from 'src/tools/agent_control/subrun/shared';
import { ToolRegistry, toolRegistry } from '../../tools/toolRegistry';

export const RESEARCH_CARRIER_CONVERSATION = 'research-carrier-conversation';
export const RESEARCH_CARRIER_TOOL = 'research_run';
export type CarrierBoundary = 'draft_completed' | 'reviews_completed' | 'before_parent_return';

export function researchCarrierRequest(projectId: string): ConversationNextRequest {
  return {
    conversation_id: RESEARCH_CARRIER_CONVERSATION,
    project_id: projectId,
    new_events: [
      { type: 'user_input', content: 'Review the synthetic note.', source: 'user', timestamp: 1 },
    ],
    options: {
      promptKey: 'default',
      model_id: 'scripted-test-model',
      project_metadata: { id: projectId, name: 'Synthetic research' },
      host_tool_call: {
        tool_name: RESEARCH_CARRIER_TOOL,
        args: {},
        completion_mode: 'yield_after_batch',
      },
    },
  };
}

export const researchCarrierDraftTurns: ScriptedLlmTurn[] = [
  {
    toolCalls: [
      {
        id: 'carrier-draft-write',
        name: 'write_file',
        argumentsJson: JSON.stringify({
          locator: 'workspace:/synthetic-note.md',
          content:
            '# Synthetic note\n\nThe fixture reports 12 units from a closed synthetic source.',
        }),
      },
    ],
  },
  { contentChunks: ['Synthetic note saved at workspace:/synthetic-note.md.'] },
];
export const researchCarrierFollowingTurns: ScriptedLlmTurn[] = [
  { contentChunks: ['Argument review: the conclusion remains conditional.'] },
  { contentChunks: ['Source review: the synthetic value is 12 units.'] },
  { contentChunks: ['All fixed stages completed; retain the synthetic note.'] },
];

/** 只验证承载：真实注册职责、ToolNode、持久 child 与固定阶段，不提供生产研究规则。 */
export class ResearchCarrierFixtureTool extends BaseTool {
  readonly name: string = RESEARCH_CARRIER_TOOL;
  readonly description = 'Host-only fixed-stage carrier fixture.';
  readonly parameters = { type: 'object' as const, properties: {}, additionalProperties: false };
  invocations = 0;

  constructor(
    private readonly boundary?: (point: CarrierBoundary, context: ToolContext) => Promise<void>
  ) {
    super();
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    z.object({}).strict().parse(args);
    this.invocations += 1;
    const parentToolCallId = context.parentToolCallId;
    if (!parentToolCallId || !context.modelId || !context.abortSignal)
      throw new Error('Carrier requires the formal parent tool context');
    const signal = context.abortSignal;
    const stage = async (slot: string, promptKey: string, userMessage: string) => {
      signal.throwIfAborted();
      const result = await runRegisteredSubagent({
        context,
        promptKey,
        description: slot,
        userMessage,
        inheritTurns: 0,
        maxSteps: 800,
        modelId: context.modelId,
        subrunId: `${parentToolCallId}_${slot}`,
        subrunSource: RESEARCH_CARRIER_TOOL,
        subrunMetadata: { stage: slot },
      });
      signal.throwIfAborted();
      if (!result.success) throw new Error(`Stage ${slot} failed: ${result.error}`);
      return result;
    };
    const draft = await stage(
      'draft',
      'subagent_document_editor',
      'Write the supplied synthetic note to workspace:/synthetic-note.md.'
    );
    await this.boundary?.('draft_completed', context);
    signal.throwIfAborted();
    // 两个职责同时接纳，输入只来自共同前序；不能把同伴意见带进另一份请求。
    const reviewSettlements = await Promise.allSettled([
      stage(
        'argument_review',
        'research_argument_review_v1',
        `Inspect only the argument. ${draft.finalAnswer}`
      ),
      stage(
        'source_review',
        'research_source_review_v1',
        `Inspect only the synthetic source. ${draft.finalAnswer}`
      ),
    ]);
    // 一个 child 中断不能让仍在提交的同伴失去宿主；先收口本批，再向父级传播恢复边界。
    const reviews = reviewSettlements.map(result => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
    await this.boundary?.('reviews_completed', context);
    signal.throwIfAborted();
    const final = await stage(
      'final',
      'subagent_document_editor',
      reviews.map(result => result.finalAnswer).join('\n')
    );
    await this.boundary?.('before_parent_return', context);
    signal.throwIfAborted();
    const results = [draft, ...reviews, final];
    return JSON.stringify({
      observation: 'The four fixed synthetic stages completed.',
      data: {
        subrun_ids: results.map(result => result.subrunId),
        answers: results.map(result => result.finalAnswer),
      },
    });
  }
}

/** 只注入工具查找；执行、参数校验、returned receipt 和错误分类均经过正式 ToolRegistry。 */
export function installResearchCarrierFixture(
  tool: ResearchCarrierFixtureTool,
  additionalTools: BaseTool[] = []
): void {
  const getTool = ToolRegistry.prototype.getTool.bind(toolRegistry);
  const supplied = new Map([tool, ...additionalTools].map(entry => [entry.name, entry]));
  vi.spyOn(toolRegistry, 'getTool').mockImplementation(name => supplied.get(name) ?? getTool(name));
}
