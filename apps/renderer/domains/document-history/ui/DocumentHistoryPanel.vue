<template>
  <Modal
    :is-visible="true"
    :title="message('history.title')"
    width="1100px"
    max-width="94vw"
    max-height="88vh"
    scroll-mode="content"
    @close="emit('close')"
  >
    <div v-if="state.error" class="document-history-error" role="alert">
      {{ message(`history.error.${state.error}`) }}
    </div>
    <p v-if="state.phase === 'loading'">{{ message('history.loading') }}</p>
    <div v-else class="document-history-body">
      <nav class="document-history-list" :aria-label="message('history.title')">
        <button
          v-for="version in state.recent"
          :key="version.versionId"
          type="button"
          class="document-history-version"
          :class="{ 'is-selected': state.selectedId === version.versionId }"
          :disabled="state.phase === 'restoring'"
          @click="controller.select(version.versionId)"
        >
          <span>{{ formatTime(version.createdAt) }}</span
          ><small v-if="version.isCurrent">{{ message('history.current') }}</small>
        </button>
        <details v-if="state.earlier.length">
          <summary>{{ message('history.earlier') }}</summary>
          <button
            v-for="version in state.earlier"
            :key="version.versionId"
            type="button"
            class="document-history-version"
            :class="{ 'is-selected': state.selectedId === version.versionId }"
            :disabled="state.phase === 'restoring'"
            @click="controller.select(version.versionId)"
          >
            {{ formatTime(version.createdAt) }}
          </button>
        </details>
        <p v-if="!state.recent.length">{{ message('history.empty') }}</p>
      </nav>
      <div class="document-history-preview">
        <component
          :is="previewComponent"
          v-if="state.selectedId"
          :key="state.selectedId"
          :document-id="documentId"
          :version-id="state.selectedId"
        />
      </div>
    </div>
    <template #footer>
      <ActionButtons
        :primary-action-text="
          message(state.phase === 'restoring' ? 'history.restoring' : 'history.restore')
        "
        :secondary-action-text="message('history.close')"
        :show-secondary-action="true"
        :is-primary-action-disabled="!canRestore"
        @primary-click="confirming = true"
        @secondary-click="emit('close')"
      />
    </template>
  </Modal>
  <AlertDialog
    :visible="confirming"
    :title="message('history.restore')"
    :message="message('history.confirm')"
    :confirm-text="message('history.restore')"
    :cancel-text="message('history.cancel')"
    :is-confirmation="true"
    @confirm="confirmRestore"
    @cancel="confirming = false"
    @close="confirming = false"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue';
import { Modal, ActionButtons, AlertDialog } from '@linnya/renderer-ui';
import { createHistoryPanelState } from '../store/historyPanelState';
import { createHistoryPanelController } from '../orchestration/createHistoryPanelController';
import { historyPanelIpc } from '../infrastructure/historyPanelIpc';
import { useHistoryMessages } from '../locales/historyMessages';

const props = defineProps<{ documentId: string; previewComponent: Component }>();
const emit = defineEmits<{ close: [] }>();
const { message, locale } = useHistoryMessages();
const store = createHistoryPanelState();
const { state } = store;
const controller = createHistoryPanelController(props.documentId, store, historyPanelIpc);
const confirming = ref(false);
const canRestore = computed(
  () =>
    state.value.phase === 'ready' &&
    !!state.value.selectedId &&
    state.value.selectedId !== state.value.recent[0]?.versionId
);
const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'medium' }).format(
    timestamp
  );
function confirmRestore() {
  confirming.value = false;
  void controller.restore();
}
onMounted(() => {
  void controller.load();
});
onBeforeUnmount(controller.close);
</script>
