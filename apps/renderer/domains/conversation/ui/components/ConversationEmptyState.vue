<template>
  <div class="conversation-empty-state">
    <div class="conversation-empty-state__icon">
      <LinnyaIcon class="conversation-empty-state__icon-svg" />
    </div>
    <div class="conversation-empty-state__copy">
      <h3>{{ conversationMessage('conversation.view.empty.title') }}</h3>
      <p>{{ conversationMessage('conversation.view.empty.description') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { LinnyaIcon } from '@linnya/renderer-ui/icons';
import { useConversationLocalization } from '../useConversationLocalization';

const { conversationMessage } = useConversationLocalization();
</script>
