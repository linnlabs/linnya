<template>
  <div
    ref="hostRef"
    class="skills-preview-card"
    role="button"
    :tabindex="disabled ? -1 : 0"
    :aria-label="label"
    :aria-disabled="disabled"
    data-overlay-scroll-theme="linnya"
    data-overlay-scroll-visibility="strict-hover"
    @click="open"
    @keydown.enter.self="open"
    @keydown.space.self.prevent="open"
  >
    <div
      ref="viewportMountRef"
      class="skills-preview-scroll"
      data-overlayscrollbars-initialize
    >
      <div class="skills-preview-content">
        <SkillFilePreview
          v-if="content !== null"
          :path="path"
          :content="content"
        />
        <SettingsState
          v-else
          kind="error"
          :message="errorMessage"
        />
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';
import { SettingsState } from '@/domains/settings/public';
import SkillFilePreview from './SkillFilePreview.vue';

const props = defineProps<{ path: string; content: string | null; disabled: boolean; label: string; errorMessage: string }>();
const emit = defineEmits<{ open: [] }>();
const hostRef = ref<HTMLElement | null>(null);
const viewportMountRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const scroll = useOverlayScrollViewport({ bindings: { hostRef, viewportMountRef, viewportRef } });

function open(): void { if (!props.disabled) emit('open'); }
onMounted(() => scroll.init());
watch(() => [props.path, props.content], async () => {
  await nextTick();
  const viewport = scroll.getViewport();
  if (viewport) viewport.scrollTop = 0;
  scroll.scheduleUpdate();
});
</script>
