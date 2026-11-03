import { PromptKeys } from '@app/schemas';
import { generateMessageId } from '@shared/utils/idUtils';
import { readAuxiliaryPurposeLowestReasoningEffort } from '@/domains/model-configuration';
import { generateText } from '@/shared/services/aiService/unifiedApiService';
import { useConversationState } from '../../../store/conversationState';
import { historyApiService } from '../../../history/services/historyApiService';
import { useHistoryListStore } from '../../../history/store/historyListStore';
import type { ConversationTitleCoordinator } from '../definitions/conversationTitle';
import { buildAutomaticConversationTitlePrompt } from '../functions/conversationTitleText';
import { useConversationTitleCandidateStore } from '../store/conversationTitleCandidateStore';
import { useConversationTitleSettingsStore } from '../store/conversationTitleSettingsStore';
import { createConversationTitleCoordinator } from './conversationTitleCoordinator';

const coordinatorByCandidateStore = new WeakMap<object, ConversationTitleCoordinator>();

export function useConversationTitleFeature(): ConversationTitleCoordinator {
  const candidateStore = useConversationTitleCandidateStore();
  const existing = coordinatorByCandidateStore.get(candidateStore);
  if (existing) return existing;

  const settingsStore = useConversationTitleSettingsStore();
  const conversationState = useConversationState();
  const historyListStore = useHistoryListStore();
  const coordinator = createConversationTitleCoordinator({
    candidates: candidateStore,
    isAutomaticTitleEnabled: () => settingsStore.isAutomaticTitleEnabled,
    createGenerationId: generateMessageId,
    generateTitle: async (conversationId, userText, generationId, signal) => {
      const response = await generateText({
        prompt: buildAutomaticConversationTitlePrompt(userText),
        prompt_key: PromptKeys.CONVERSATION_TITLE,
        conversationId,
        turn_id: `conversation_title:${generationId}`,
        persist: false,
        history_mode: 'isolated',
        run_lane: 'auxiliary',
        event_visibility: 'none',
        // 标题不需要深度思考：用标题模型支持的最弱档；模型不声明思考档时沿用原有默认。
        reasoning_effort: readAuxiliaryPurposeLowestReasoningEffort(PromptKeys.CONVERSATION_TITLE) ?? undefined,
      }, signal);
      return response.generated_text;
    },
    persistTitle: async (conversationId, title) => {
      await historyApiService.updateTitle(conversationId, title);
    },
    commitTitle: (conversationId, title, origin) => {
      conversationState.updateConversationTitle(conversationId, title, origin);
      historyListStore.updateConversation(conversationId, { title });
    },
    reportFallbackPersistenceFailure: (conversationId, error) => {
      console.warn('[ConversationTitle] 首问标题持久化失败', {
        conversationId,
        error,
      });
    },
    reportGenerationFailure: (conversationId, error) => {
      console.warn('[ConversationTitle] 新会话自动标题生成失败，保留首问标题', {
        conversationId,
        error,
      });
    },
  });

  coordinatorByCandidateStore.set(candidateStore, coordinator);
  return coordinator;
}
