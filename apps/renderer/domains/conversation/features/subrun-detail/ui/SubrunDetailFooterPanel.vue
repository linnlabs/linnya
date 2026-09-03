<template>
  <div class="subrun-detail-footer conversation-footer-shell">
    <div
      class="subrun-detail-footer__surface conversation-footer-surface"
      :data-status="presentation.status"
    >
      <div class="subrun-detail-footer__summary">
        <span class="subrun-detail-footer__status-dot" aria-hidden="true" />
        <div class="subrun-detail-footer__copy">
          <span class="subrun-detail-footer__status">{{ statusLabel }}</span>
          <span v-if="modelDisplayName" class="subrun-detail-footer__model">
            {{ conversationMessage('conversation.tool.subrunDetail.model', { model: modelDisplayName }) }}
          </span>
        </div>
      </div>

      <button class="subrun-detail-footer__back" type="button" @click="navigation.close()">
        <ChevronIcon class="subrun-detail-footer__back-icon" direction="left" />
        <span>{{ conversationMessage('conversation.tool.subrunDetail.back') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';

import { useModelCatalogReadModel } from '@/domains/model-configuration';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import type { ConversationMessageKey } from '../../../definitions/conversationMessages';
import type { ToolCallMessage } from '../../../types';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import { SUBRUN_DETAIL_NAVIGATION_PORT_KEY } from '../definitions/subrunDetail';
import { requireSubrunDetailNavigation } from '../functions/requireSubrunDetailNavigation';
import { projectSubrunDetailFooterPresentation } from '../functions/projectSubrunDetailFooterPresentation';

const props = defineProps<{
  readonly parentMessage: ToolCallMessage;
  readonly subrunId: string;
}>();

const navigation = requireSubrunDetailNavigation(inject(SUBRUN_DETAIL_NAVIGATION_PORT_KEY));
const modelCatalog = useModelCatalogReadModel();
const { conversationMessage } = useConversationLocalization();
const presentation = computed(() => projectSubrunDetailFooterPresentation({
  parentMessage: props.parentMessage,
  subrunId: props.subrunId,
}));
const modelDisplayName = computed(() => {
  const modelId = presentation.value.modelId;
  if (!modelId) return null;
  const model = modelCatalog.models.value.find(candidate => candidate.id === modelId);
  return model?.display_name || model?.name || modelId;
});
const statusMessageKey = computed<ConversationMessageKey>(() => {
  switch (presentation.value.status) {
    case 'running': return 'conversation.tool.subrunDetail.status.running';
    case 'completed': return 'conversation.tool.subrunDetail.status.completed';
    case 'partial': return 'conversation.tool.subrunDetail.status.partial';
    case 'cancelled': return 'conversation.tool.subrunDetail.status.cancelled';
    case 'failed': return 'conversation.tool.subrunDetail.status.failed';
  }
});
const statusLabel = computed(() => conversationMessage(statusMessageKey.value));
</script>
