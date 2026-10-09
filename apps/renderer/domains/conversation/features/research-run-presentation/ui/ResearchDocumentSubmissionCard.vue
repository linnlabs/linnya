<template>
  <ConversationResourceLinkNode
    v-if="presentation.data.kind === 'saved'"
    :href="presentation.data.artifactPath"
    :authored-title="conversationMessage('conversation.tool.researchSubmit.open')"
  />
</template>

<script setup lang="ts">
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type { ToolCardPresentation } from '../../../ui/tools/types';
import { ConversationResourceLinkNode } from '../../resource-link';
import type { ResearchDocumentSubmissionPresentationData } from '../definitions/researchDocumentSubmissionPresentation';

defineProps<{
  presentation: ToolCardPresentation<ResearchDocumentSubmissionPresentationData>;
}>();
const { conversationMessage } = useConversationLocalization();
</script>
