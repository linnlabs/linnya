import {
  AssembleDocumentsArgsSchema,
  AssembleDocumentsToolOutputSchema,
  EvidenceResolveArgsSchema,
  EvidenceResolveToolOutputSchema,
} from '@app/schemas';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import type { EvidenceHeaderPresentationData } from '../definitions/evidenceHeaderPresentation';

type EvidenceHeaderToolName = 'assemble_documents' | 'evidence_resolve';

function readToolName(input: ToolPresentationProjectorInput): EvidenceHeaderToolName {
  if (
    input.sourceToolName === input.uiKey &&
    (input.uiKey === 'assemble_documents' || input.uiKey === 'evidence_resolve')
  ) {
    return input.uiKey;
  }
  throw new Error(
    `Unsupported Evidence header presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`
  );
}

export function projectEvidenceHeaderPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<EvidenceHeaderPresentationData> {
  const toolName = readToolName(input);
  const operation = toolName === 'evidence_resolve' ? 'read' : 'write';
  const title = createConversationToolTitleDescriptor(
    operation === 'read' ? 'conversation.tool.evidence.read' : 'conversation.tool.evidence.write'
  );

  if (toolName === 'assemble_documents') {
    if (input.status === 'success') {
      const args = AssembleDocumentsArgsSchema.parse(input.args);
      const result = AssembleDocumentsToolOutputSchema.parse(input.result);
      if (result.data.query !== args.query) {
        throw new Error('assemble_documents result query does not match request');
      }
    }
  } else {
    if (input.status === 'success') {
      const args = EvidenceResolveArgsSchema.parse(input.args);
      const result = EvidenceResolveToolOutputSchema.parse(input.result);
      if (result.data.mode !== args.mode) {
        throw new Error('evidence_resolve result mode does not match request');
      }
    }
  }

  return {
    data: {
      kind: input.status === 'success' ? 'complete' : 'lifecycle',
      operation,
    },
    title,
  };
}
