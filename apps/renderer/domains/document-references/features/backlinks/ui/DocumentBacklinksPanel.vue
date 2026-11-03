<template>
  <Modal
    :is-visible="true"
    :title="message('backlinks.title')"
    width="560px"
    max-width="92vw"
    scroll-mode="content"
    @close="emit('close')"
  >
    <div class="document-backlinks-panel">
      <div class="document-backlinks-toolbar">
        <p role="status">
          {{
            message('backlinks.summary', {
              documents: state.documentCount,
              references: state.referenceCount,
            })
          }}
        </p>
        <BaseButton
          variant="plain"
          :disabled="state.phase === 'loading'"
          @click="controller.load()"
        >
          {{ message('backlinks.refresh') }}
        </BaseButton>
      </div>
      <p
        v-if="state.error"
        role="alert"
      >
        {{ message('backlinks.error') }}
      </p>
      <p v-if="state.phase === 'loading'">
        {{ message('backlinks.loading') }}
      </p>
      <p v-else-if="!state.documents.length && !state.error">
        {{ message('backlinks.empty') }}
      </p>
      <ul class="document-backlinks-list">
        <li
          v-for="source in state.documents"
          :key="source.sourceDocumentId"
        >
          <button
            type="button"
            @click="controller.open(source)"
          >
            <component
              :is="readIcon(source.nodeType)"
              class="document-backlinks-icon"
              aria-hidden="true"
            />
            <span>{{ source.title }}</span><small>{{ message('backlinks.count', { count: source.referenceCount }) }}</small>
          </button>
        </li>
      </ul>
      <BaseButton
        v-if="state.nextOffset !== null"
        variant="plain"
        :disabled="state.phase === 'loading'"
        @click="controller.load(true)"
      >
        {{ message('backlinks.more') }}
      </BaseButton>
    </div>
  </Modal>
</template>
<script setup lang="ts">
import { onBeforeUnmount, type Component } from 'vue';
import { BaseButton, Modal } from '@linnya/renderer-ui';
import { createBacklinksPanelState } from '../store/backlinksPanelState';
import { createBacklinksPanelController } from '../orchestration/createBacklinksPanelController';
import { createBacklinksPanelPort } from '../adapters/createBacklinksPanelPort';
import { useBacklinksMessages } from '../locales/backlinksMessages';
const props = defineProps<{
  documentId: string;
  projectId: string;
  readIcon: (nodeType: string) => Component;
}>();
const emit = defineEmits<{ close: [] }>();
const { message } = useBacklinksMessages();
const store = createBacklinksPanelState();
const state = store.state;
const controller = createBacklinksPanelController(
  { documentId: props.documentId, projectId: props.projectId },
  store,
  createBacklinksPanelPort(props.projectId)
);
void controller.load();
onBeforeUnmount(controller.close);
</script>
<style scoped>
.document-backlinks-panel {
  padding: 12px 4px;
}
.document-backlinks-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--color-text-secondary);
}
.document-backlinks-list {
  list-style: none;
  padding: 0;
}
.document-backlinks-list button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px;
  text-align: left;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
}
.document-backlinks-list button:hover {
  background: var(--color-bg-subtle);
}
.document-backlinks-list button:focus-visible {
  outline: 2px solid var(--color-border-focus);
}
.document-backlinks-list small {
  margin-left: auto;
  color: var(--color-text-secondary);
  white-space: nowrap;
}
.document-backlinks-icon {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
}
</style>
