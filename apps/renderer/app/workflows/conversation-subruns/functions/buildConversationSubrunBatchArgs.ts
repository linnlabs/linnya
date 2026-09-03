import { SubrunBatchArgsSchema, type SubrunBatchArgs } from '@app/schemas';
import type { StartConversationSubrunsRequest } from '@plugin/renderer/conversationSubrunInvocationPort';

export function buildConversationSubrunBatchArgs(options: {
  readonly request: StartConversationSubrunsRequest;
  readonly workerPromptKey: string;
  readonly createId: () => string;
}): SubrunBatchArgs {
  return SubrunBatchArgsSchema.parse({
    worker_prompt_key: options.workerPromptKey,
    subruns: options.request.subruns.map(subrun => ({
      unit_id: `subrun-unit-${options.createId()}`,
      subrun_id: `subrun-${options.createId()}`,
      description: subrun.description,
      prompt: subrun.prompt,
    })),
  });
}
