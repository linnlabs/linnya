<template>
  <div v-if="presentation.data.kind === 'delivered'">
    <ConversationResourceLinkNode
      :href="presentation.data.articlePath"
      :authored-title="conversationMessage('conversation.tool.researchComplete.openArticle')"
    />
    <ConversationResourceLinkNode
      v-for="path in presentation.data.reviewPaths"
      :key="path"
      :href="path"
      :authored-title="conversationMessage('conversation.tool.researchComplete.openReview')"
    />
  </div>
</template>

<script setup lang="ts">
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type { ToolCardPresentation } from '../../../ui/tools/types';
import { ConversationResourceLinkNode } from '../../resource-link';
import type { ResearchCompletionPresentationData } from '../definitions/researchCompletionPresentation';

defineProps<{
  presentation: ToolCardPresentation<ResearchCompletionPresentationData>;
}>();
const { conversationMessage } = useConversationLocalization();
</script>
