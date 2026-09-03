import {
  ListKnowledgeBaseArgsSchema,
  ListKnowledgeBaseResultSchema,
  HistoricalResourceListArgsSchema,
  HistoricalResourceKnowledgeBaseListResultSchema,
} from '@app/schemas';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type {
  DocumentListPresentationData,
  DocumentListPresentationItem,
} from '../definitions/documentListPresentation';

function admitUiKey(input: ToolPresentationProjectorInput): void {
  if (input.uiKey === 'list_knowledge_base') return;
  throw new Error(`Unsupported document list presentation key: ${input.uiKey}`);
}

function admitRequest(input: ToolPresentationProjectorInput): void {
  if (input.sourceToolName === 'list_knowledge_base') {
    ListKnowledgeBaseArgsSchema.parse(input.args);
    return;
  }
  if (input.sourceToolName === 'resource_list') {
    const args = HistoricalResourceListArgsSchema.parse(input.args);
    if (args.source !== 'knowledge_base') {
      throw new Error(
        `resource_list source ${args.source} cannot use document list presentation for knowledge`
      );
    }
    return;
  }
  throw new Error(
    `Unsupported document list presentation source: source=${input.sourceToolName}, uiKey=${input.uiKey}`
  );
}

function readDocuments(
  input: ToolPresentationProjectorInput,
): readonly DocumentListPresentationItem[] {
  if (input.sourceToolName === 'list_knowledge_base') {
    return ListKnowledgeBaseResultSchema.parse(input.result).data.documents;
  }
  return HistoricalResourceKnowledgeBaseListResultSchema.parse(input.result).data.documents;
}

export function projectDocumentListPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<DocumentListPresentationData> {
  admitUiKey(input);
  const title = createConversationToolTitleDescriptor(
    'conversation.tool.knowledgeSearch.configListTitle'
  );

  if (input.status !== 'success') {
    if (input.sourceToolName === 'resource_list') {
      const lifecycleArgs = HistoricalResourceListArgsSchema.safeParse(input.args);
      if (lifecycleArgs.success && lifecycleArgs.data.source !== 'knowledge_base') {
        throw new Error(
          `resource_list source ${lifecycleArgs.data.source} cannot use document list presentation for knowledge`
        );
      }
    }
    return { data: { kind: 'lifecycle' }, title };
  }

  admitRequest(input);
  return {
    data: {
      kind: 'snapshot',
      documents: readDocuments(input).map(document => ({
        id: document.id,
        title: document.title,
      })),
    },
    title,
  };
}
