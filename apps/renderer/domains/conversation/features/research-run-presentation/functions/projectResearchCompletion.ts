import { CompleteResearchArgsSchema, CompleteResearchResultSchema } from '@app/schemas';
import type { ConversationMessageKey } from '../../../definitions/conversationMessages';
import {
  createConversationToolLocalizedTextDescriptor,
  createConversationToolTitleDescriptor,
} from '../../../ui/tools/functions/createConversationToolTitleDescriptor';
import type {
  ToolCompactStepPresentation,
  ToolCompactStepProjectorInput,
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../../ui/tools/types';
import type { ResearchCompletionPresentationData } from '../definitions/researchCompletionPresentation';

function requireCompletionIdentity(input: { sourceToolName: string; uiKey: string }): void {
  if (input.sourceToolName !== 'complete_research' || input.uiKey !== 'complete_research') {
    throw new Error('Unsupported research completion presentation identity');
  }
}

function titleKey(status: ToolPresentationProjectorInput['status']): ConversationMessageKey {
  switch (status) {
    case 'loading': return 'conversation.tool.researchComplete.pending';
    case 'success': return 'conversation.tool.researchComplete.delivered';
    case 'error': return 'conversation.tool.researchComplete.failed';
  }
}

export function projectResearchCompletion(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<ResearchCompletionPresentationData> {
  requireCompletionIdentity(input);
  const title = createConversationToolTitleDescriptor(titleKey(input.status));
  // 交付检查失败不等于研究已结束；主 Agent 仍可读取原因并决定后续动作。
  if (input.status !== 'success') return { title, data: { kind: 'lifecycle' }, hideContent: true };
  CompleteResearchArgsSchema.parse(input.args);
  const result = CompleteResearchResultSchema.parse(input.result);
  return {
    title,
    data: {
      kind: 'delivered',
      articlePath: result.data.artifact.path,
      // strict 交付合同保证两份产物分别是论证和来源复核；标签跟随 stage，不依赖返回顺序。
      reviewLinks: result.data.review_artifacts.map(artifact => ({
        path: artifact.path,
        label: createConversationToolLocalizedTextDescriptor(artifact.stage === 'argument_review'
          ? 'conversation.tool.researchComplete.argumentReview'
          : 'conversation.tool.researchComplete.sourceReview'),
      })),
    },
  };
}

export function projectResearchCompletionCompactStep(
  input: ToolCompactStepProjectorInput,
): ToolCompactStepPresentation {
  requireCompletionIdentity(input);
  if (input.status === 'success') {
    CompleteResearchArgsSchema.parse(input.args);
    CompleteResearchResultSchema.parse(input.result);
  }
  return { title: createConversationToolLocalizedTextDescriptor(titleKey(input.status)) };
}
