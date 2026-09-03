<template>
  <article
    class="spike-message"
    :class="`spike-message--${message.author}`"
  >
    <header class="spike-message__header">
      <span>{{ message.author === 'user' ? 'User' : 'Assistant' }}</span>
      <code>#{{ message.sequence }}</code>
    </header>

    <p
      v-for="paragraph in message.paragraphs"
      :key="paragraph"
      class="spike-message__paragraph"
    >
      {{ paragraph }}
    </p>

    <div
      v-if="message.image"
      class="spike-message__image-frame"
      :style="{
        width: `${message.image.widthPx}px`,
        height: `${message.image.heightPx}px`,
      }"
    >
      <img
        v-if="imageVisible"
        class="spike-message__image"
        src="/icons/icon.ico"
        alt="Delayed fixture content"
        :width="message.image.widthPx"
        :height="message.image.heightPx"
      >
    </div>

    <div
      class="spike-message__card-body"
      :class="{ 'spike-message__card-body--expanded': cardExpanded }"
    >
      <div class="spike-message__card-body-content">
        <strong>Expandable task details</strong>
        <p>The measured row expands in one layout step.</p>
        <p>The next visible row must keep its painted position after remeasurement.</p>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { VirtualizerSpikeMessage } from '../definitions/virtualizerSpike';

const props = defineProps<{
  message: VirtualizerSpikeMessage;
  cardExpanded?: boolean;
}>();

const imageVisible = ref(false);
let imageTimer: number | null = null;

const scheduleImage = (): void => {
  if (imageTimer !== null) {
    window.clearTimeout(imageTimer);
    imageTimer = null;
  }
  imageVisible.value = false;
  if (!props.message.image) return;

  imageTimer = window.setTimeout(() => {
    imageVisible.value = true;
    imageTimer = null;
  }, props.message.image.delayMs);
};

watch(
  () => props.message.image
    ? `${props.message.id}:${props.message.image.delayMs}:${props.message.image.widthPx}:${props.message.image.heightPx}`
    : `${props.message.id}:no-image`,
  scheduleImage,
  { immediate: true },
);

onBeforeUnmount(() => {
  if (imageTimer !== null) window.clearTimeout(imageTimer);
});
</script>

