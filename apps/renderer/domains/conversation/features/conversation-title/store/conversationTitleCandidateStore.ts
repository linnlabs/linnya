import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type {
  AutomaticConversationTitleCandidate,
  ConversationTitleCandidatePort,
} from '../definitions/conversationTitle';

export const useConversationTitleCandidateStore = defineStore('conversationTitleCandidates', () => {
  const candidates = shallowRef(new Map<string, AutomaticConversationTitleCandidate>());

  function replaceCandidate(
    conversationId: string,
    candidate: AutomaticConversationTitleCandidate,
  ): void {
    const next = new Map(candidates.value);
    next.set(conversationId, candidate);
    candidates.value = next;
  }

  const getCandidate: ConversationTitleCandidatePort['getCandidate'] = (conversationId) => {
    return candidates.value.get(conversationId) ?? null;
  };

  const registerCandidate: ConversationTitleCandidatePort['registerCandidate'] = (conversationId) => {
    if (!conversationId || candidates.value.has(conversationId)) return;
    replaceCandidate(conversationId, { status: 'eligible' });
  };

  const claimCandidate: ConversationTitleCandidatePort['claimCandidate'] = (
    conversationId,
    generationId,
    userText,
  ) => {
    if (candidates.value.get(conversationId)?.status !== 'eligible') return false;
    replaceCandidate(conversationId, {
      status: 'generating',
      generationId,
      userText,
    });
    return true;
  };

  const releaseCandidate: ConversationTitleCandidatePort['releaseCandidate'] = (conversationId) => {
    if (!candidates.value.has(conversationId)) return;
    const next = new Map(candidates.value);
    next.delete(conversationId);
    candidates.value = next;
  };

  const isCurrentGeneration: ConversationTitleCandidatePort['isCurrentGeneration'] = (
    conversationId,
    generationId,
  ) => {
    const candidate = candidates.value.get(conversationId);
    return candidate?.status === 'generating' && candidate.generationId === generationId;
  };

  const clearCandidates: ConversationTitleCandidatePort['clearCandidates'] = () => {
    candidates.value = new Map();
  };

  return {
    candidates,
    getCandidate,
    registerCandidate,
    claimCandidate,
    releaseCandidate,
    isCurrentGeneration,
    clearCandidates,
  };
});
