<template>
  <section
    class="ppt-plan-look"
    :class="{ 'ppt-plan-look--expanded': expanded, 'ppt-plan-look--compact': compact }"
  >
    <figure v-if="look.cover && coverPhase !== 'failed'" class="ppt-plan-look__cover">
      <button
        type="button"
        class="ppt-plan-look__cover-button"
        :disabled="compact || coverPhase !== 'ready'"
        :aria-label="expanded ? slidesToolCardMessage('slides.plan.look.coverCollapse') : slidesToolCardMessage('slides.plan.look.coverExpand')"
        @click="expanded = !expanded"
      >
        <SlidesVersionCover
          :document-id="look.cover.presentationId"
          :version-id="look.cover.versionId"
          :width-px="compact ? 160 : 720"
          @phase="coverPhase = $event"
        />
        <span v-if="coverPhase === 'loading'" class="ppt-plan-look__cover-placeholder">
          {{ slidesToolCardMessage('slides.plan.look.coverLoading') }}
        </span>
      </button>
      <figcaption v-if="!compact" class="ppt-plan-look__caption">
        {{ slidesToolCardMessage('slides.plan.look.cover') }}
        <template v-if="coverPhase === 'ready'">
          · {{ expanded ? slidesToolCardMessage('slides.plan.look.coverCollapse') : slidesToolCardMessage('slides.plan.look.coverExpand') }}
        </template>
      </figcaption>
    </figure>
    <p v-else-if="look.cover && !compact" class="ppt-plan-look__caption">
      {{ slidesToolCardMessage('slides.plan.look.coverUnavailable') }}
    </p>

    <dl v-if="!compact" class="ppt-plan-look__spec">
      <div>
        <dt>{{ slidesToolCardMessage('slides.plan.label.palette') }}</dt>
        <dd>
          <span class="ppt-plan-look__swatches">
            <span
              v-for="(color, index) in baseColors"
              :key="`base-${index}`"
              class="ppt-plan-look__swatch"
              :style="{ background: color }"
              :title="color"
            />
            <span class="ppt-plan-look__swatch-gap" />
            <span
              v-for="(color, index) in look.palette.accents"
              :key="`accent-${index}`"
              class="ppt-plan-look__swatch"
              :style="{ background: color }"
              :title="color"
            />
          </span>
          <span class="ppt-plan-look__legend">{{ slidesToolCardMessage('slides.plan.look.paletteLegend') }}</span>
        </dd>
      </div>
      <div>
        <dt>{{ slidesToolCardMessage('slides.plan.label.fonts') }}</dt>
        <dd class="ppt-plan-look__fonts">
          <span v-for="font in look.fonts" :key="font">{{ font }}</span>
        </dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import type { PptPlanLookData } from './pptPlanInteraction';
import { useSlidesToolCardLocalization } from '../ui/useSlidesToolCardLocalization';

// 栅格化依赖较重，只有计划带封面时才加载。
const SlidesVersionCover = defineAsyncComponent(
  () => import('../../features/presentationHistory/ui/SlidesVersionCover.vue'),
);

const props = defineProps<{ look: PptPlanLookData; compact?: boolean }>();
const { slidesToolCardMessage } = useSlidesToolCardLocalization();

const expanded = ref(false);
const coverPhase = ref<'loading' | 'ready' | 'failed'>('loading');
const baseColors = computed(() => [...props.look.palette.backgrounds, props.look.palette.ink]);
</script>
