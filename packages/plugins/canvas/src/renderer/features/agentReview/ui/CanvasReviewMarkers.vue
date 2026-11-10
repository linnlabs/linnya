<template>
  <div class="canvas-review-markers" @pointerdown.stop>
    <div
      v-for="marker in markers"
      :key="`${marker.groupId}:${marker.id}`"
      class="canvas-review-indicator"
      :class="marker.kind"
      :style="{
        left: `${marker.x}px`,
        top: `${marker.y}px`,
        width: marker.width ? `${marker.width}px` : undefined,
        height: marker.height ? `${marker.height}px` : undefined,
      }"
    >
      <button
        type="button"
        class="canvas-review-indicator-dot"
        :aria-label="`${marker.description} · ${marker.title}`"
        @click="reveal(marker)"
      >
        <span v-if="marker.kind === 'deleted'">{{
          t('canvas.review.marker.deleted', { title: marker.title })
        }}</span>
      </button>
      <div class="canvas-review-popover">
        <p>{{ marker.description }} · {{ marker.title }}</p>
        <div class="canvas-review-popover-actions">
          <BaseButton
            variant="plain"
            size="sm"
            :disabled="busy || readonly"
            @click="review.withdraw(marker.groupId, [marker.id])"
          >
            {{
              t(
                marker.kind === 'deleted'
                  ? 'canvas.review.restore'
                  : 'canvas.review.marker.withdrawCard'
              )
            }}
          </BaseButton>
          <BaseButton
            variant="plain"
            tone="accent"
            size="sm"
            :disabled="busy"
            @click="review.review(marker.id, marker.groupId)"
          >
            {{ t('canvas.review.marker.viewed') }}
          </BaseButton>
        </div>
      </div>
    </div>
    <button
      v-for="hint in directions"
      :key="hint.direction"
      type="button"
      class="canvas-review-direction"
      :class="hint.direction"
      :aria-label="
        t('canvas.review.marker.offscreen', {
          side: t(`canvas.side.${hint.direction}`),
          count: hint.targets.length,
        })
      "
      @click="revealFirst(hint)"
    >
      <ChevronIcon :direction="chevrons[hint.direction]" class="canvas-review-direction-icon" />
      {{ hint.targets.length }}
    </button>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { BaseButton } from '@linnya/renderer-ui';
import { canvasText as t } from '../../localization';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import type {
  CanvasReviewDirection,
  CanvasReviewMarker,
  CanvasReviewTarget,
} from '../definitions/agentReview';
import { projectCanvasReviewDirections } from '../functions/projectCanvasReviewMarkers';
import type { createCanvasAgentReview } from '../orchestration/createCanvasAgentReview';
const props = withDefaults(
  defineProps<{
    markers: readonly CanvasReviewMarker[];
    review: ReturnType<typeof createCanvasAgentReview>;
    readonly?: boolean;
    viewport?: { readonly width: number; readonly height: number };
  }>(),
  { viewport: undefined }
);
const emit = defineEmits<{ reveal: [target: CanvasReviewTarget] }>();
const busy = computed(() => props.review.state.busy.value);
const directions = computed(() =>
  props.viewport ? projectCanvasReviewDirections(props.markers, props.viewport) : []
);
const chevrons = { left: 'left', right: 'right', top: 'up', bottom: 'down' } as const;
function reveal(target: CanvasReviewTarget) {
  props.review.focus(target.id);
  emit('reveal', target);
  void props.review.review(target.id, target.groupId);
}
function revealFirst(hint: CanvasReviewDirection) {
  const target = hint.targets[0];
  if (target) reveal(target);
}
</script>
