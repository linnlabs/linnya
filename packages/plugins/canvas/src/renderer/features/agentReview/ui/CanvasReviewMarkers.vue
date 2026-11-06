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
        <span v-if="marker.kind === 'deleted'">已删除 · {{ marker.title }}</span>
      </button>
      <div class="canvas-review-popover">
        <p>{{ marker.description }} · {{ marker.title }}</p>
        <button
          type="button"
          :disabled="busy || readonly"
          @click="review.withdraw(marker.groupId, [marker.id])"
        >
          {{ marker.kind === 'deleted' ? '恢复' : '撤回此卡' }}
        </button>
        <button type="button" :disabled="busy" @click="review.review(marker.id, marker.groupId)">
          已查看
        </button>
      </div>
    </div>
    <button
      v-for="hint in directions"
      :key="hint.direction"
      type="button"
      class="canvas-review-direction"
      :class="hint.direction"
      :aria-label="`${directionLabels[hint.direction]}侧有 ${hint.targets.length} 张 Agent 改动卡片`"
      @click="revealFirst(hint)"
    >
      {{ directionLabels[hint.direction] }} {{ hint.targets.length }}
    </button>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
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
const directionLabels = { left: '←', right: '→', top: '↑', bottom: '↓' };
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
