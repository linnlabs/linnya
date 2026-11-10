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
import './documentBacklinksPanel.css';
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
