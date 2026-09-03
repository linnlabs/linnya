import type {
  AutomaticConversationTitleSource,
  ConversationTitleCoordinator,
  ConversationTitleCoordinatorDependencies,
} from '../definitions/conversationTitle';
import {
  buildFallbackConversationTitle,
  normalizeConversationTitleText,
} from '../functions/conversationTitleText';

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function createConversationTitleCoordinator(
  dependencies: ConversationTitleCoordinatorDependencies,
): ConversationTitleCoordinator {
  const generationControllers = new Map<string, AbortController>();
  const titleWriteQueues = new Map<string, Promise<void>>();
  const automaticWritesInFlight = new Map<string, string>();

  function cancelGeneration(conversationId: string): void {
    generationControllers.get(conversationId)?.abort();
    generationControllers.delete(conversationId);
    dependencies.candidates.releaseCandidate(conversationId);
  }

  function enqueueTitleWrite(
    conversationId: string,
    write: () => Promise<void>,
  ): Promise<void> {
    const previous = titleWriteQueues.get(conversationId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(write);
    titleWriteQueues.set(conversationId, current);
    void current.then(() => {
      if (titleWriteQueues.get(conversationId) === current) {
        titleWriteQueues.delete(conversationId);
      }
    }, () => {
      if (titleWriteQueues.get(conversationId) === current) {
        titleWriteQueues.delete(conversationId);
      }
    });
    return current;
  }

  function sealForSubsequentUserAction(conversationId: string): void {
    const candidate = dependencies.candidates.getCandidate(conversationId);
    const inFlightGenerationId = automaticWritesInFlight.get(conversationId);
    cancelGeneration(conversationId);

    if (
      candidate?.status !== 'generating'
      || candidate.generationId !== inFlightGenerationId
    ) {
      return;
    }

    const fallbackTitle = buildFallbackConversationTitle(candidate.userText);
    if (!fallbackTitle) return;
    void enqueueTitleWrite(conversationId, async () => {
      await dependencies.persistTitle(conversationId, fallbackTitle);
      dependencies.commitTitle(conversationId, fallbackTitle, 'fallback');
    }).catch((error: unknown) => {
      dependencies.reportFallbackPersistenceFailure(conversationId, error);
    });
  }

  async function generateAutomaticTitle(
    source: AutomaticConversationTitleSource,
    generationId: string,
    controller: AbortController,
  ): Promise<void> {
    try {
      const generated = await dependencies.generateTitle(
        source.conversationId,
        source.userText,
        generationId,
        controller.signal,
      );
      const title = normalizeConversationTitleText(generated);
      if (
        !title
        || !dependencies.candidates.isCurrentGeneration(source.conversationId, generationId)
      ) {
        return;
      }

      await enqueueTitleWrite(source.conversationId, async () => {
        if (!dependencies.candidates.isCurrentGeneration(source.conversationId, generationId)) {
          return;
        }
        automaticWritesInFlight.set(source.conversationId, generationId);
        try {
          await dependencies.persistTitle(source.conversationId, title);
          if (!dependencies.candidates.isCurrentGeneration(source.conversationId, generationId)) {
            return;
          }
          dependencies.commitTitle(source.conversationId, title, 'automatic');
        } finally {
          if (automaticWritesInFlight.get(source.conversationId) === generationId) {
            automaticWritesInFlight.delete(source.conversationId);
          }
        }
      });
    } catch (error) {
      if (!isAbortError(error)) {
        dependencies.reportGenerationFailure(source.conversationId, error);
      }
    } finally {
      if (generationControllers.get(source.conversationId) === controller) {
        generationControllers.delete(source.conversationId);
      }
      if (dependencies.candidates.isCurrentGeneration(source.conversationId, generationId)) {
        dependencies.candidates.releaseCandidate(source.conversationId);
      }
    }
  }

  return {
    registerAutomaticCandidate(conversationId) {
      dependencies.candidates.registerCandidate(conversationId);
    },

    async handleUserMessage(source) {
      const candidate = dependencies.candidates.getCandidate(source.conversationId);
      if (!candidate) return;

      // 下一次用户动作是明确的生命周期边界；未完成的首问标题不得在后续交互中落下。
      if (candidate.status !== 'eligible') {
        sealForSubsequentUserAction(source.conversationId);
        return;
      }

      const fallbackTitle = buildFallbackConversationTitle(source.userText);
      if (!fallbackTitle) {
        dependencies.candidates.releaseCandidate(source.conversationId);
        return;
      }

      const persistFallback = enqueueTitleWrite(source.conversationId, async () => {
        await dependencies.persistTitle(source.conversationId, fallbackTitle);
        dependencies.commitTitle(source.conversationId, fallbackTitle, 'fallback');
      }).catch((error: unknown) => {
        dependencies.reportFallbackPersistenceFailure(source.conversationId, error);
      });

      if (!dependencies.isAutomaticTitleEnabled()) {
        dependencies.candidates.releaseCandidate(source.conversationId);
        await persistFallback;
        return;
      }

      const generationId = dependencies.createGenerationId();
      const normalizedUserText = normalizeConversationTitleText(source.userText);
      if (!dependencies.candidates.claimCandidate(
        source.conversationId,
        generationId,
        normalizedUserText,
      )) {
        await persistFallback;
        return;
      }
      const controller = new AbortController();
      generationControllers.set(source.conversationId, controller);
      void generateAutomaticTitle(
        { ...source, userText: normalizedUserText },
        generationId,
        controller,
      );
      await persistFallback;
    },

    sealForSubsequentUserAction,

    async renameConversation(conversationId, title) {
      const normalizedTitle = normalizeConversationTitleText(title);
      if (!conversationId || !normalizedTitle) return;
      cancelGeneration(conversationId);
      await enqueueTitleWrite(conversationId, async () => {
        await dependencies.persistTitle(conversationId, normalizedTitle);
        dependencies.commitTitle(conversationId, normalizedTitle, 'explicit');
      });
    },

    discardConversation(conversationId) {
      cancelGeneration(conversationId);
    },

    reset() {
      for (const controller of generationControllers.values()) controller.abort();
      generationControllers.clear();
      automaticWritesInFlight.clear();
      titleWriteQueues.clear();
      dependencies.candidates.clearCandidates();
    },
  };
}
