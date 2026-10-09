import { SubmitResearchDocumentArgsSchema, SubmitResearchDocumentResultSchema } from '@app/schemas';
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
import type { ResearchDocumentSubmissionPresentationData } from '../definitions/researchDocumentSubmissionPresentation';

function requireSubmissionIdentity(input: { sourceToolName: string; uiKey: string }): void {
  if (input.sourceToolName !== 'submit_research_document' || input.uiKey !== 'submit_research_document') {
    throw new Error('Unsupported research document submission presentation identity');
  }
}

function titleKey(status: ToolPresentationProjectorInput['status']): ConversationMessageKey {
  switch (status) {
    case 'loading': return 'conversation.tool.researchSubmit.pending';
    case 'success': return 'conversation.tool.researchSubmit.saved';
    case 'error': return 'conversation.tool.researchSubmit.failed';
  }
}

export function projectResearchDocumentSubmission(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<ResearchDocumentSubmissionPresentationData> {
  requireSubmissionIdentity(input);
  const title = createConversationToolTitleDescriptor(titleKey(input.status));
  // 校验失败只属于本次提交；模型仍可在同一 child 内修正，不能据此给整个研究判终态。
  if (input.status !== 'success') return { title, data: { kind: 'lifecycle' }, hideContent: true };
  SubmitResearchDocumentArgsSchema.parse(input.args);
  const result = SubmitResearchDocumentResultSchema.parse(input.result);
  return { title, data: { kind: 'saved', artifactPath: result.data.path } };
}

export function projectResearchDocumentSubmissionCompactStep(
  input: ToolCompactStepProjectorInput,
): ToolCompactStepPresentation {
  requireSubmissionIdentity(input);
  if (input.status === 'success') {
    SubmitResearchDocumentArgsSchema.parse(input.args);
    SubmitResearchDocumentResultSchema.parse(input.result);
  }
  return { title: createConversationToolLocalizedTextDescriptor(titleKey(input.status)) };
}
