import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import { requireRendererAiInvocationPort } from '@plugin/renderer/aiInvocationPort';
import { slidesApi } from '../../../services/slidesApi';
import { useSlidesStore } from '../../../store/slidesStore';
import {
  buildSlidesElementAiEditContext,
  buildSlidesElementAiEditSourceTargets,
} from '../functions/elementAiEditContext';
import type { SlidesElementAiEditSubmitPayload } from '../definitions/elementAiEditTypes';

export function useSlidesElementAiEditWorkflow() {
  const slidesStore = useSlidesStore();
  const aiInvocationPort = requireRendererAiInvocationPort();
  const { currentDeckId } = storeToRefs(slidesStore);
  const isSubmitting = ref(false);

  async function submitElementAiEdit(payload: SlidesElementAiEditSubmitPayload): Promise<boolean> {
    if (isSubmitting.value) {
      return false;
    }

    const presentationId = currentDeckId.value;
    if (!presentationId) {
      setWorkflowError('当前没有打开的演示文稿，无法发送点选编辑。');
      return false;
    }
    if (payload.targets.length === 0) {
      setWorkflowError('请先选中至少一个可编辑元素。');
      return false;
    }

    isSubmitting.value = true;
    try {
      const conversation = await aiInvocationPort.ensureConversation({
        agentChoiceId: 'ppt',
      });
      if (!conversation?.conversationId) {
        setWorkflowError('无法创建 PPT AI 会话，请重新打开侧边栏后再试。');
        return false;
      }

      const sourceSlices = await slidesApi.readSourceSlicesForAiEdit({
        nodeId: presentationId,
        conversationId: conversation.conversationId,
        targets: buildSlidesElementAiEditSourceTargets(payload),
      });
      if (sourceSlices.sourceOrigin === 'draft' || sourceSlices.draftStatus) {
        setWorkflowError('当前 deck.js 有未修复草稿。请先让 AI 修复草稿，再继续点选编辑。');
        return false;
      }

      const context = buildSlidesElementAiEditContext({
        presentationId,
        payload,
        sourceSlices,
      });

      return await aiInvocationPort.sendMessage({
        prompt: context.visiblePrompt,
        enableTools: true,
        conversationId: conversation.conversationId,
        fences: [context.selectedSlidesElementFence],
        userQuote: context.userQuote,
      });
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : '点选编辑发送失败。');
      return false;
    } finally {
      isSubmitting.value = false;
    }
  }

  function setWorkflowError(message: string): void {
    aiInvocationPort.reportError(message);
  }

  return {
    isSubmitting,
    submitElementAiEdit,
  };
}
