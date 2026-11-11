<template>
  <!-- 图片搜索不套卡片：一行查询词与张数，下面一排来源缩略图，角上标许可，点开看大图。 -->
  <div class="image-search-line">
    <ToolInlineLine
      :icon="ImageIcon"
      :loading="presentation.status === 'loading'"
      :text="presentation.status === 'loading'
        ? conversationMessage('conversation.tool.imageSearch.running', { query: data.query })
        : conversationMessage('conversation.tool.imageSearch.title', { query: data.query })"
      :meta="countText"
    />
    <div
      v-if="visibleThumbnails.length > 0"
      class="image-search-strip"
    >
      <button
        v-for="item in visibleThumbnails"
        :key="item.thumbnailUrl"
        type="button"
        class="image-search-strip__item"
        :data-linnya-tooltip="`${item.title} · ${item.licenseName}`"
        :aria-label="`${item.title} · ${item.licenseName}`"
        @click="openPreview(item, $event)"
      >
        <img
          :src="item.thumbnailUrl"
          :alt="item.title"
          crossorigin="anonymous"
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          @error="failedThumbnails.add(item.thumbnailUrl)"
        >
        <span class="image-search-strip__license">{{ licenseLabel(item) }}</span>
      </button>
      <span
        v-if="restCount > 0"
        class="image-search-strip__more"
      >+{{ restCount }}</span>
    </div>
    <ImagePreviewModal
      :is-visible="selected !== null"
      :src="selected?.previewUrl ?? ''"
      :alt="selected?.title ?? ''"
      :source-element="previewSource"
      cross-origin="anonymous"
      @close="selected = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ImagePreviewModal, useImagePreviewSource } from '@linnya/renderer-ui';
import { ImageIcon } from '@linnya/renderer-ui/icons';
import { useConversationLocalization } from '../../useConversationLocalization';
import ToolInlineLine from '../shared/ToolInlineLine.vue';
import type { ToolCardPresentation } from '../types';
import type { ImageSearchPresentationData, ImageSearchThumbnail } from './functions/projectImageSearchPresentation';

const props = defineProps<{
  readonly presentation: ToolCardPresentation<ImageSearchPresentationData>;
}>();

const { conversationMessage } = useConversationLocalization();
const data = computed(() => props.presentation.data);
// 来源站点偶尔拿不到缩略图（例如 Flickr 图床 502）；拿不到的不占位。
const failedThumbnails = reactive(new Set<string>());
const visibleThumbnails = computed(() => data.value.thumbnails.filter(item => !failedThumbnails.has(item.thumbnailUrl)));
const restCount = computed(() => (data.value.candidateCount ?? 0) - visibleThumbnails.value.length);

const countText = computed(() => {
  const count = data.value.candidateCount;
  if (props.presentation.status !== 'success' || count === undefined) return undefined;
  return count === 0
    ? conversationMessage('conversation.tool.imageSearch.none')
    : conversationMessage('conversation.tool.imageSearch.count', { count });
});

function licenseLabel(item: ImageSearchThumbnail): string {
  if (item.licenseCode === 'pdm') return conversationMessage('conversation.tool.imageLicense.publicDomain');
  if (item.licenseCode === 'other') return conversationMessage('conversation.tool.imageLicense.other');
  if (item.licenseCode === 'cc0') return 'CC0';
  return `CC ${item.licenseCode.toUpperCase()}`;
}

const selected = ref<ImageSearchThumbnail | null>(null);
const { sourceElement: previewSource, rememberSource } = useImagePreviewSource();
function openPreview(item: ImageSearchThumbnail, event: Event): void {
  rememberSource(event, '.image-search-strip__item');
  selected.value = item;
}
</script>
