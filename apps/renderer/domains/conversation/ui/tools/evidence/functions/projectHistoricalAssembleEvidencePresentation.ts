import {
  HistoricalAssembleEvidenceArgsSchema,
  HistoricalAssembleEvidenceToolOutputSchema,
} from '@app/schemas';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import type { EvidenceHeaderPresentationData } from '../definitions/evidenceHeaderPresentation';

/** 只解释已经持久化的 assemble_evidence 事件；backend 不存在同名 executable。 */
export function projectHistoricalAssembleEvidencePresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<EvidenceHeaderPresentationData> {
  if (input.sourceToolName !== 'assemble_evidence' || input.uiKey !== 'assemble_evidence') {
    throw new Error(
      `Unsupported historical assemble_evidence presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`
    );
  }
  if (input.status === 'success') {
    const args = HistoricalAssembleEvidenceArgsSchema.parse(input.args);
    const result = HistoricalAssembleEvidenceToolOutputSchema.parse(input.result);
    if (result.data.query !== args.query) {
      throw new Error('historical assemble_evidence result query does not match request');
    }
  }
  return {
    data: {
      kind: input.status === 'success' ? 'complete' : 'lifecycle',
      operation: 'write',
    },
    title: createConversationToolTitleDescriptor('conversation.tool.evidence.write'),
  };
}
