import type { AiMessage } from '../../../contracts';
import type { FenceRegistry } from '../fences';
import { BasePreprocessor, type PreprocessorContext, type PreprocessorResult } from './base';
import { PREPROCESSOR_PRIORITY } from './priority';

export interface FenceLifetimePreprocessorOptions {
  fenceRegistry: FenceRegistry;
}

export class FenceLifetimePreprocessor extends BasePreprocessor {
  readonly name = 'FenceLifetimePreprocessor';
  readonly description = 'Removes expired turn-only context injection messages from history';
  readonly priority = PREPROCESSOR_PRIORITY.fenceLifetimeCleanup;

  private readonly fenceRegistry: FenceRegistry;

  constructor(options: FenceLifetimePreprocessorOptions) {
    super();
    this.fenceRegistry = options.fenceRegistry;
  }

  async process(
    messages: AiMessage[],
    context: PreprocessorContext,
  ): Promise<PreprocessorResult> {
    const latestUserInputIndex = findLastIndex(messages, message => {
      return message.role === 'user' && message.type === 'user_input';
    });
    let modifiedCount = 0;
    const processedMessages: AiMessage[] = [];

    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      if (message.type !== 'context_injection') {
        processedMessages.push(message);
        continue;
      }

      const fenceKind = message.metadata?.fenceKind;
      if (!fenceKind) {
        processedMessages.push(message);
        continue;
      }

      const descriptor = this.fenceRegistry.get(fenceKind);
      if (!descriptor) {
        this.debug(`Fence kind "${fenceKind}" is not registered; keeping message.`, { messageId: message.id }, context);
        processedMessages.push(message);
        continue;
      }

      const isHistorical = latestUserInputIndex === -1 || index < latestUserInputIndex;
      if (descriptor.lifetime === 'turn-only' && isHistorical) {
        modifiedCount++;
        continue;
      }

      processedMessages.push(message);
    }

    return this.createResult(
      messages,
      processedMessages,
      modifiedCount > 0 ? ['fence_lifetime'] : [],
      modifiedCount,
    );
  }
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) {
      return index;
    }
  }
  return -1;
}
