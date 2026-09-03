<template>
  <div class="command-execution-card">
    <div class="command-execution-card__terminal-window">
      <div class="command-execution-card__command-line">
        <span class="command-execution-card__prompt" aria-hidden="true">$</span>
        <code class="command-execution-card__command">{{ commandText }}</code>
      </div>

      <div
        v-if="ptyScreen"
        class="command-execution-card__output command-execution-card__output--pty"
      >
        <PtyTerminalScreen :screen="ptyScreen" />
      </div>
      <pre v-else-if="data.observation" class="command-execution-card__output">{{
        data.observation
      }}</pre>
      <div v-else-if="data.state === 'starting'" class="command-execution-card__empty">
        {{ conversationMessage('conversation.tool.command.starting') }}
      </div>

      <div
        v-if="
          data.incomplete ||
          shellData?.lastProcessRejectionCode ||
          settlementFailureText ||
          auditIncomplete
        "
        class="command-execution-card__notices"
      >
        <div v-if="data.incomplete" class="command-execution-card__warning">
          {{ incompleteText }}
        </div>
        <div v-if="shellData?.lastProcessRejectionCode" class="command-execution-card__warning">
          {{
            conversationMessage('conversation.tool.command.actionRejected', {
              action: shellData.lastProcessAction || 'process',
            })
          }}
        </div>
        <div v-if="settlementFailureText" class="command-execution-card__warning">
          {{ settlementFailureText }}
        </div>
        <div v-if="auditIncomplete" class="command-execution-card__warning">
          {{ conversationMessage('conversation.tool.command.auditIncomplete') }}
        </div>
      </div>

      <div class="command-execution-card__footer">
        <div class="command-execution-card__footer-left">
          <span class="command-execution-card__status" :class="`is-${data.state}`">
            {{ footerStatusText }}
          </span>
          <button
            v-if="canCancel"
            type="button"
            class="command-execution-card__cancel"
            :disabled="isCancelling"
            :title="conversationMessage('conversation.tool.command.cancel')"
            :aria-label="conversationMessage('conversation.tool.command.cancel')"
            @click="cancelCurrentCommand"
          >
            <CloseIcon />
          </button>
          <button
            v-if="canSubmitProtectedInput"
            type="button"
            class="command-execution-card__protected-input"
            :title="conversationMessage('conversation.tool.command.protectedInput.open')"
            @click="openProtectedInput"
          >
            <SecretVisibilityIcon :visible="false" />
            <span>{{ conversationMessage('conversation.tool.command.protectedInput.open') }}</span>
          </button>
        </div>
        <div class="command-execution-card__footer-right">
          <span v-if="durationText" class="command-execution-card__duration">
            {{ durationText }}
          </span>
          <button
            type="button"
            class="command-execution-card__copy"
            :class="{
              'is-copied': copyFeedback === 'copied',
              'is-failed': copyFeedback === 'failed',
            }"
            :title="copyButtonTitle"
            :aria-label="copyButtonTitle"
            @click="copyCommandAndOutput"
          >
            <CopyIcon />
          </button>
        </div>
      </div>
    </div>
    <CommandProtectedInputDialog
      :visible="protectedInputVisible"
      :command="commandText"
      :submitting="protectedInputSubmitting"
      :error-text="protectedInputErrorText"
      @close="closeProtectedInput"
      @submit="submitProtectedInput"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';

import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type {
  CommandExecutionPresentationData,
  ShellCommandExecutionPresentationData,
} from '../definitions/commandExecutionPresentation';
import {
  formatCommandExecutionDuration,
  projectCommandClipboardText,
  projectCommandIncompleteReasonKeys,
} from '../functions/projectCommandExecutionDetails';
import PtyTerminalScreen from './PtyTerminalScreen.vue';
import CommandProtectedInputDialog from './CommandProtectedInputDialog.vue';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import { CopyIcon } from '@linnya/renderer-ui/icons';
import { SecretVisibilityIcon } from '@linnya/renderer-ui/icons';
import { useCommandCardControlStore } from '../store/commandCardControlStore';
import {
  cancelCommandFromCurrentCard,
  submitProtectedInputFromCurrentCard,
} from '../orchestration/useCommandCardControl';
import { applyCommandCardSettlement } from '../functions/applyCommandCardSettlement';
import './CommandExecutionCard.css';

const props = defineProps<{
  readonly presentation: ToolCardPresentation<CommandExecutionPresentationData>;
  readonly messageId?: string;
  readonly conversationId?: string;
}>();
const { conversationMessage, currentLocale } = useConversationLocalization();
const controlStore = useCommandCardControlStore();
const protectedInputVisible = ref(false);
const protectedInputSubmitting = ref(false);
const protectedInputFailureCode = ref<string>();
const copyFeedback = ref<'idle' | 'copied' | 'failed'>('idle');
let copyFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
const sourceData = computed(() => props.presentation.data);
const settlement = computed(() => {
  const source = sourceData.value;
  if (
    source.kind === 'command_execution_lifecycle' ||
    source.source !== 'shell' ||
    (!source.processHandle && !source.toolCallId)
  )
    return undefined;
  const snapshot = controlStore.snapshot;
  if (!snapshot || snapshot.conversation_id !== props.conversationId) return undefined;
  return snapshot.settlements.find(
    value =>
      (source.processHandle !== undefined && value.process_handle === source.processHandle) ||
      (source.toolCallId !== undefined &&
        value.origin_tool_call_id !== undefined &&
        value.origin_tool_call_id === source.toolCallId)
  );
});
const data = computed(() => applyCommandCardSettlement(sourceData.value, settlement.value));
const shellData = computed<ShellCommandExecutionPresentationData | null>(() =>
  data.value.kind === 'command_execution' && data.value.source === 'shell' ? data.value : null
);
const commandText = computed(
  () =>
    shellData.value?.command ??
    (data.value.kind === 'command_execution' && data.value.source === 'process'
      ? conversationMessage('conversation.tool.command.processAction', {
          action: data.value.action,
        })
      : conversationMessage('conversation.tool.command.running'))
);
const ptyScreen = computed(() =>
  data.value.display?.mode === 'pty' ? (data.value.display.screen ?? null) : null
);
const canCancel = computed(() => {
  const source = data.value;
  return (
    source.kind === 'command_execution' &&
    source.source === 'shell' &&
    source.state === 'running' &&
    Boolean(
      controlStore.snapshot?.capabilities.some(
        value => value.process_handle === source.processHandle
      )
    )
  );
});
const canSubmitProtectedInput = computed(() => {
  const source = data.value;
  if (
    source.kind !== 'command_execution' ||
    source.source !== 'shell' ||
    source.state !== 'running' ||
    !source.processHandle
  )
    return false;
  return Boolean(
    controlStore.snapshot?.capabilities.some(
      value => value.process_handle === source.processHandle && value.protected_input_ticket
    )
  );
});
const isCancelling = computed(
  () =>
    data.value.kind === 'command_execution' &&
    data.value.source === 'shell' &&
    controlStore.cancellingHandle === data.value.processHandle
);
const settlementFailureText = computed(() => {
  const source = data.value;
  if (
    source.kind !== 'command_execution' ||
    source.source !== 'shell' ||
    !source.processHandle ||
    source.state !== 'running'
  )
    return '';
  if (controlStore.snapshot?.settlement_failures.includes(source.processHandle)) {
    return conversationMessage('conversation.tool.command.settlementSaveFailed');
  }
  if (controlStore.pageUnavailable) {
    return conversationMessage('conversation.tool.command.controlUnavailable');
  }
  if (controlStore.failedHandle === source.processHandle) {
    return conversationMessage('conversation.tool.command.cancelFailed');
  }
  return '';
});
const auditIncomplete = computed(() => {
  if (data.value.executionFacts?.audit_status === 'incomplete') return true;
  const processHandle =
    data.value.kind === 'command_execution' ? data.value.processHandle : undefined;
  const snapshot = controlStore.snapshot;
  if (!processHandle || !snapshot || snapshot.conversation_id !== props.conversationId)
    return false;
  return snapshot.audit_failures.includes(processHandle);
});
async function cancelCurrentCommand(): Promise<void> {
  const source = data.value;
  if (source.kind !== 'command_execution' || source.source !== 'shell' || !source.processHandle)
    return;
  await cancelCommandFromCurrentCard(source.processHandle);
}
function openProtectedInput(): void {
  protectedInputFailureCode.value = undefined;
  protectedInputVisible.value = true;
}
function closeProtectedInput(): void {
  if (protectedInputSubmitting.value) return;
  protectedInputVisible.value = false;
  protectedInputFailureCode.value = undefined;
}
async function submitProtectedInput(input: string): Promise<void> {
  const source = data.value;
  if (
    source.kind !== 'command_execution' ||
    source.source !== 'shell' ||
    !source.processHandle ||
    protectedInputSubmitting.value
  )
    return;
  protectedInputSubmitting.value = true;
  protectedInputFailureCode.value = undefined;
  const result = await submitProtectedInputFromCurrentCard(source.processHandle, input);
  protectedInputSubmitting.value = false;
  if (result.status === 'accepted') {
    protectedInputVisible.value = false;
    return;
  }
  protectedInputFailureCode.value = result.status === 'stale' ? 'stale' : result.code;
}
const protectedInputErrorText = computed(() => {
  const code = protectedInputFailureCode.value;
  if (!code) return '';
  if (code === 'stdin_closed' || code === 'incompatible_state' || code === 'stale') {
    return conversationMessage('conversation.tool.command.protectedInput.unavailable');
  }
  return conversationMessage('conversation.tool.command.protectedInput.failed');
});
watch(canSubmitProtectedInput, available => {
  if (available) return;
  protectedInputVisible.value = false;
  protectedInputSubmitting.value = false;
  protectedInputFailureCode.value = undefined;
});
const stateText = computed(() =>
  conversationMessage(`conversation.tool.command.state.${data.value.state}`)
);
const footerStatusText = computed(() => {
  const terminal = data.value.terminal;
  if (!terminal || terminal.outcome === 'exited') return stateText.value;
  if (terminal.outcome === 'runtime_failure') {
    return conversationMessage('conversation.tool.command.runtimeFailure');
  }
  return conversationMessage(`conversation.tool.command.terminated.${terminal.reason}`);
});
const durationText = computed(() => {
  const timing = data.value.executionFacts?.timing;
  if (!timing || timing.status !== 'started' || timing.settled_at_ms === undefined) return '';
  return formatCommandExecutionDuration(
    timing.started_at_ms,
    timing.settled_at_ms,
    currentLocale.value
  );
});
const copyButtonTitle = computed(() => {
  if (copyFeedback.value === 'copied') {
    return conversationMessage('conversation.turn.action.copied');
  }
  if (copyFeedback.value === 'failed') {
    return conversationMessage('conversation.turn.export.copyFailed');
  }
  return conversationMessage('conversation.tool.command.copy');
});
function settleCopyFeedback(next: 'copied' | 'failed'): void {
  copyFeedback.value = next;
  if (copyFeedbackTimer !== undefined) clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = setTimeout(() => {
    copyFeedback.value = 'idle';
    copyFeedbackTimer = undefined;
  }, 2_000);
}
async function copyCommandAndOutput(): Promise<void> {
  try {
    await navigator.clipboard.writeText(
      projectCommandClipboardText(commandText.value, data.value.observation)
    );
    settleCopyFeedback('copied');
  } catch (error: unknown) {
    console.error('[CommandExecutionCard] 复制命令和输出失败:', error);
    settleCopyFeedback('failed');
  }
}
const incompleteText = computed(() => {
  const reasons = projectCommandIncompleteReasonKeys(data.value.incompleteReasons).map(key =>
    conversationMessage(key)
  );
  const title = conversationMessage('conversation.tool.command.outputIncomplete');
  return reasons.length === 0 ? title : `${title}：${reasons.join('；')}`;
});
onBeforeUnmount(() => {
  if (copyFeedbackTimer !== undefined) clearTimeout(copyFeedbackTimer);
});
</script>
