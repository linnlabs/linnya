<template>
  <div class="tooloutput-read-card">
    <div v-if="status === 'loading'" class="loading-state">
      <div class="loading-spinner" />
      <span>{{ conversationMessage('conversation.tool.toolOutput.loading') }}</span>
    </div>

    <div v-else-if="status === 'success' && snapshot" class="content-container">
      <div class="header-meta">
        <span class="subtitle" :title="conversationMessage('conversation.tool.toolOutput.moreResults')">
          <DocumentIcon class="subtitle-icon" />
          <span class="subtitle-filename">{{ conversationMessage('conversation.tool.toolOutput.moreResults') }}</span>
          <span class="subtitle-range">{{ lineRange }}</span>
        </span>
      </div>

      <div class="content-card">
        <div class="content-wrapper">
          <pre class="raw-text">{{ snapshot.result.window_text }}</pre>
        </div>
      </div>
    </div>

    <div v-else-if="status === 'error'" class="error-state">
      <div class="error-text">{{ conversationMessage('conversation.tool.toolOutput.failed') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { useConversationLocalization } from '../../useConversationLocalization';
import type { ToolCardPresentation } from '../types';
import type { ToolOutputReadPresentationData } from './definitions/toolOutputReadPresentation';

const props = defineProps<{
  presentation: ToolCardPresentation<ToolOutputReadPresentationData>;
  messageId?: string;
}>();

const { conversationMessage } = useConversationLocalization();
const status = computed(() => props.presentation.status);
const snapshot = computed(() => (
  props.presentation.data.kind === 'snapshot' ? props.presentation.data : null
));
const lineRange = computed(() => snapshot.value?.lineRange ?? '');
</script>
