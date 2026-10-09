<template>
  <div v-if="presentation.data.kind === 'delivered'">
    <ConversationResourceLinkNode
      :href="presentation.data.articlePath"
      :authored-title="conversationMessage('conversation.tool.researchComplete.openArticle')"
    />
    <div
      v-for="review in presentation.data.reviewLinks"
      :key="review.path"
    >
      <span>{{ localizedText(review.label) }}：</span>
      <ConversationResourceLinkNode
        :href="review.path"
        :authored-title="localizedText(review.label)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useLocalization } from '@app/localization';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type { ToolCardPresentation } from '../../../ui/tools/types';
import { ConversationResourceLinkNode } from '../../resource-link';
import type { ResearchCompletionPresentationData } from '../definitions/researchCompletionPresentation';

defineProps<{
  presentation: ToolCardPresentation<ResearchCompletionPresentationData>;
}>();
const { conversationMessage } = useConversationLocalization();
const { t: localizedText } = useLocalization();
</script>
