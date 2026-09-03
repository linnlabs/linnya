import {
  SubrunBatchArgsSchema,
  SubrunBatchStructuredResultSchema,
} from '@app/schemas';
import type {
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../../ui/tools/types';
import type {
  SubrunBatchPresentationData,
  SubrunCollectionItemStatus,
} from '../definitions/subrunCollection';
import {
  createConversationToolTitleDescriptor,
} from '../../../ui/tools/functions/createConversationToolTitleDescriptor';
import { buildSubrunBatchCollectionItems } from './buildSubrunBatchCollectionItems';

export function projectSubrunBatchPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<SubrunBatchPresentationData> {
  if (input.sourceToolName !== 'subrun_batch' || input.uiKey !== 'subrun_batch') {
    throw new Error(
      `Unsupported subrun batch presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`,
    );
  }
  const args = SubrunBatchArgsSchema.parse(input.args);
  const result = input.status === 'success'
    ? SubrunBatchStructuredResultSchema.parse(input.result)
    : undefined;
  const parentStatus: SubrunCollectionItemStatus = input.status === 'success'
    ? 'success'
    : input.status === 'error'
      ? 'error'
      : 'loading';
  return {
    title: createConversationToolTitleDescriptor('conversation.tool.subrun.batchTitle', {
      count: args.subruns.length,
    }),
    data: {
      items: buildSubrunBatchCollectionItems({ args, result, parentStatus }),
    },
  };
}
