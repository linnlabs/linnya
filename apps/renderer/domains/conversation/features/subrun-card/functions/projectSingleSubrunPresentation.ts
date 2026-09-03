import {
  SubagentArgsSchema,
  SubagentResultSchema,
} from '@app/schemas';
import type {
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../../ui/tools/types';
import type {
  SubrunCardPresentationData,
  SubrunCardStatus,
} from '../definitions/subrunCard';
import {
  createConversationToolTitleDescriptor,
} from '../../../ui/tools/functions/createConversationToolTitleDescriptor';
import { resolveSingleSubrunIdentity } from './resolveSingleSubrunIdentity';

function resolveStatus(input: ToolPresentationProjectorInput, childFailed: boolean): SubrunCardStatus {
  if (input.status === 'loading') return 'loading';
  if (input.status === 'error' || childFailed) return 'error';
  return 'success';
}

function requireMatchingDescription(argsDescription: string, resultDescription: string): void {
  if (argsDescription === resultDescription) return;
  throw new Error(
    `[SUBRUN_SINGLE_DESCRIPTION_CONFLICT] args=${argsDescription}, result=${resultDescription}`,
  );
}

function projectCanonicalSubagent(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<SubrunCardPresentationData> {
  const args = SubagentArgsSchema.parse(input.args);
  const title = createConversationToolTitleDescriptor('conversation.tool.subrun.title', {
    description: args.description,
  });
  if (input.status !== 'success') {
    const subrunId = resolveSingleSubrunIdentity({ summary: input.subrunSummary });
    return {
      data: {
        description: args.description,
        status: resolveStatus(input, false),
        subagentType: args.subagent_type ?? 'general',
        ...(subrunId ? { subrunId } : {}),
      },
      title,
    };
  }

  const result = SubagentResultSchema.parse(input.result);
  requireMatchingDescription(args.description, result.data.description);
  const subrunId = resolveSingleSubrunIdentity({
    resultSubrunId: result.data.subrun_ids[0],
    summary: input.subrunSummary,
  });
  return {
    data: {
      description: args.description,
      status: resolveStatus(input, result.data.status !== 'completed'),
      subagentType: result.data.subagent_type,
      modelId: result.data.model_id,
      outcome: result.data.status,
      ...(subrunId ? { subrunId } : {}),
    },
    title,
  };
}

/** 只接纳当前 canonical subagent；开发环境不为退役工具名保留 replay 分支。 */
export function projectSingleSubrunPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<SubrunCardPresentationData> {
  if (input.sourceToolName !== 'subagent' || input.uiKey !== 'subagent') {
    throw new Error(
      `Unsupported single subrun presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`,
    );
  }
  return projectCanonicalSubagent(input);
}
