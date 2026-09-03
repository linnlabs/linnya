<template>
  <section v-if="store.order.length > 0" class="conversation-image-edit" :aria-label="conversationMessage('conversation.userMessage.image.edit')">
    <article v-for="(item, index) in store.order" :key="itemKey(item)" class="conversation-image-edit__item">
      <button type="button" class="conversation-image-edit__preview" :disabled="!previewUrl(item)" @click="openPreview(item)">
        <img v-if="previewUrl(item)" :src="previewUrl(item)" :alt="itemName(item)">
        <span v-else>{{ conversationMessage('conversation.userMessage.image.loading') }}</span>
      </button>
      <div class="conversation-image-edit__actions">
        <button v-if="isFailedDraft(item)" type="button" :disabled="disabled" :title="conversationMessage('conversation.input.image.retry')" @click="retryDraft(item)"><RefreshIcon /></button>
        <button type="button" :disabled="disabled || index === 0" :title="conversationMessage('conversation.userMessage.image.moveLeft')" @click="controller.move(item, -1)"><ChevronIcon direction="left" /></button>
        <button type="button" :disabled="disabled || index === store.order.length - 1" :title="conversationMessage('conversation.userMessage.image.moveRight')" @click="controller.move(item, 1)"><ChevronIcon direction="right" /></button>
        <button type="button" :disabled="disabled" :title="conversationMessage('conversation.input.image.removeNamed', { name: itemName(item) })" @click="controller.remove(item)"><CloseIcon /></button>
      </div>
    </article>
  </section>
  <div class="conversation-image-edit__footer">
    <ConversationImageAttachmentPicker
      :disabled="disabled"
      :title="conversationMessage('conversation.input.image.add')"
      @files-selected="controller.stageFiles"
    />
    <span v-if="store.errorCode" class="conversation-image-edit__error">{{ conversationMessage(resolveImageAttachmentErrorMessage(store.errorCode)) }}</span>
  </div>
  <ImagePreviewModal
    :is-visible="selectedUrl !== null"
    :src="selectedUrl ?? ''"
    :alt="selectedName"
    @close="selectedKey = null"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ImagePreviewModal } from '@linnya/renderer-ui';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { RefreshIcon } from '@linnya/renderer-ui/icons';
import ConversationImageAttachmentPicker from './ConversationImageAttachmentPicker.vue';
import type { ConversationImageEditOrderItem } from '../definitions/conversationImageEditSession';
import { resolveImageAttachmentErrorMessage } from '../functions/resolveImageAttachmentErrorMessage';
import { useConversationImageEditSession } from '../orchestration/useConversationImageEditSession';
import { useConversationImagePreviews } from '../orchestration/useConversationImagePreviews';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';

defineProps<{ readonly disabled: boolean }>();
const { conversationMessage } = useConversationLocalization();
const { store, controller } = useConversationImageEditSession();
const { items: existingPreviews } = useConversationImagePreviews(() => (
  store.order.flatMap(item => {
    if (item.source !== 'existing') return [];
    const attachment = store.existingAttachments.find(candidate => candidate.id === item.attachmentId);
    return attachment ? [attachment] : [];
  })
));
const selectedKey = ref<string | null>(null);

function itemKey(item: ConversationImageEditOrderItem): string {
  return item.source === 'existing' ? `existing:${item.attachmentId}` : `draft:${item.clientId}`;
}
function previewUrl(item: ConversationImageEditOrderItem): string | null {
  if (item.source === 'existing') {
    const preview = existingPreviews.value.find(candidate => candidate.attachment.id === item.attachmentId);
    return preview?.status === 'ready' ? preview.objectUrl : null;
  }
  return store.draftItems.find(candidate => candidate.clientId === item.clientId)?.previewUrl ?? null;
}
function itemName(item: ConversationImageEditOrderItem): string {
  if (item.source === 'existing') {
    const attachment = store.existingAttachments.find(candidate => candidate.id === item.attachmentId);
    return attachment?.fileName || attachment?.label || conversationMessage('conversation.userMessage.image.unnamed');
  }
  return store.draftItems.find(candidate => candidate.clientId === item.clientId)?.fileName
    || conversationMessage('conversation.userMessage.image.unnamed');
}
function openPreview(item: ConversationImageEditOrderItem): void {
  if (previewUrl(item)) selectedKey.value = itemKey(item);
}
function isFailedDraft(item: ConversationImageEditOrderItem): boolean {
  return item.source === 'draft'
    && store.draftItems.find(candidate => candidate.clientId === item.clientId)?.status === 'failed';
}
function retryDraft(item: ConversationImageEditOrderItem): void {
  if (item.source === 'draft') controller.retry(item.clientId);
}
const selectedItem = computed(() => store.order.find(item => itemKey(item) === selectedKey.value));
const selectedUrl = computed(() => selectedItem.value ? previewUrl(selectedItem.value) : null);
const selectedName = computed(() => selectedItem.value ? itemName(selectedItem.value) : '');
</script>
