<template>
  <section
    v-if="view"
    class="command-approval-panel"
    :aria-labelledby="titleId"
  >
    <div class="command-approval-surface">
      <header class="command-approval-header">
        <span
          class="command-approval-terminal-icon"
          aria-hidden="true"
        >›_</span>
        <span>{{ conversationMessage('conversation.commandApproval.terminal') }}</span>
      </header>

      <h2
        :id="titleId"
        class="command-approval-title"
      >
        {{ conversationMessage('conversation.commandApproval.title') }}
      </h2>

      <pre class="command-approval-command"><code>{{ view.command }}</code></pre>

      <div class="command-approval-context">
        <span class="command-approval-cwd">{{ view.cwd }}</span>
        <span
          v-for="(reason, index) in view.reasons"
          :key="`${reason.type}-${index}`"
          class="command-approval-reason"
        >
          {{ conversationMessage(resolveCommandApprovalReasonMessage(reason)) }}
        </span>
        <span
          v-if="view.conversationTokenPrefix"
          class="command-approval-remembered-prefix"
        >
          {{ conversationMessage('conversation.commandApproval.rememberedPrefix') }}：
          <code>{{ view.conversationTokenPrefix.join(' ') }}</code>
        </span>
      </div>

      <div class="command-approval-footer">
        <p
          v-if="view.status === 'processing'"
          class="command-approval-processing"
          role="status"
        >
          {{ conversationMessage('conversation.commandApproval.processing') }}
        </p>
        <template v-else>
          <p
            v-if="queuedCount > 0"
            class="command-approval-queue"
          >
            {{ conversationMessage('conversation.commandApproval.queue', { count: queuedCount }) }}
          </p>
          <div class="command-approval-actions">
            <ActionButtons
              class="command-approval-deny-action"
              shape="pill"
              :show-primary-action="false"
              :secondary-action-text="conversationMessage('conversation.commandApproval.deny')"
              :is-secondary-action-disabled="isSubmitting"
              :secondary-button-attributes="denyButtonAttributes"
              @secondary-click="reply('deny')"
            />

            <div
              class="command-approval-allow-group"
              :class="{ 'has-menu': view.canAllowForConversation }"
            >
              <ActionButtons
                class="command-approval-allow-action"
                shape="pill"
                :show-secondary-action="false"
                :primary-action-text="conversationMessage('conversation.commandApproval.allowOnce')"
                :is-primary-action-disabled="isSubmitting"
                :primary-button-attributes="allowOnceButtonAttributes"
                @primary-click="reply('allow_once')"
              />
              <CustomSelect
                v-if="view.canAllowForConversation"
                class="command-approval-allow-menu"
                data-command-approval-choice-available="allow_for_conversation"
                :model-value="undefined"
                :options="allowMenuOptions"
                :disabled="isSubmitting"
                :bordered="false"
                variant="minimal"
                semantic-role="menu"
                options-max-height="none"
                options-overflow="visible"
                :title="conversationMessage('conversation.commandApproval.moreAllowOptions')"
                :trigger-aria-label="conversationMessage('conversation.commandApproval.moreAllowOptions')"
                :class-names="{
                  trigger: 'command-approval-menu-trigger',
                  selectedValue: 'command-approval-menu-value',
                  arrowIcon: 'command-approval-menu-arrow',
                  options: 'command-approval-menu-options',
                  option: 'command-approval-menu-option',
                }"
                @update:model-value="handleAllowMenuChoice"
              />
            </div>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import type { ButtonHTMLAttributes } from 'vue';
import type { CommandApprovalChoice } from '@app/schemas/commands';
import { ActionButtons } from '@linnya/renderer-ui';
import { CustomSelect } from '@linnya/renderer-ui';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import { projectCommandApprovalView } from '../definitions/commandApprovalView';
import { resolveCommandApprovalReasonMessage } from '../functions/resolveCommandApprovalReasonMessage';
import { replyToCommandApproval } from '../orchestration/useCommandApproval';
import { useCommandApprovalProjectionStore } from '../store/commandApprovalProjectionStore';

type CommandApprovalButtonAttributes = ButtonHTMLAttributes & {
  readonly 'data-command-approval-choice': 'deny' | 'allow_once';
};

const props = defineProps<{
  readonly conversationId?: string | null;
}>();

const store = useCommandApprovalProjectionStore();
const titleId = useId();
const { conversationMessage } = useConversationLocalization();
const denyButtonAttributes: CommandApprovalButtonAttributes = {
  'data-command-approval-choice': 'deny',
  class: 'command-approval-action-button',
};
const allowOnceButtonAttributes: CommandApprovalButtonAttributes = {
  'data-command-approval-choice': 'allow_once',
  class: 'command-approval-action-button command-approval-allow-once-button',
};
const pending = computed(() => {
  if (props.conversationId === undefined) return store.snapshot?.pending[0];
  return store.snapshot?.pending.find(value => value.conversation_id === props.conversationId);
});
const view = computed(() => (
  pending.value ? projectCommandApprovalView(pending.value) : undefined
));
const queuedCount = computed(() => Math.max(0, (
  store.snapshot?.pending.filter(value => (
    props.conversationId === undefined || value.conversation_id === props.conversationId
  )).length ?? 0
) - 1));
const isSubmitting = computed(() => store.submittingRequestId === view.value?.requestId);
const allowMenuOptions = computed(() => [{
  value: 'allow_for_conversation',
  text: conversationMessage('conversation.commandApproval.allowForConversation'),
  className: 'command-approval-allow-for-conversation-option',
}]);

async function reply(choice: CommandApprovalChoice): Promise<void> {
  if (!view.value) return;
  await replyToCommandApproval(view.value.requestId, choice);
}

function handleAllowMenuChoice(choice: unknown): void {
  if (choice !== 'allow_for_conversation') return;
  void reply(choice);
}
</script>
