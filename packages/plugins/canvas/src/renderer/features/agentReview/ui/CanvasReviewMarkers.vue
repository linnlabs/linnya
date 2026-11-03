<template>
  <div class="canvas-review-markers">
    <button
      v-for="marker in markers"
      :key="`${marker.groupId}:${marker.id}`"
      type="button"
      :class="['canvas-review-marker', marker.kind]"
      :style="{ left: `${marker.x}px`, top: `${marker.y}px`, width: marker.width ? `${marker.width}px` : undefined, height: marker.height ? `${marker.height}px` : undefined }"
      :aria-label="marker.kind === 'deleted' ? 'Agent 已删除卡片，点击确认已查看' : 'Agent 改动，点击确认已查看'"
      @click="review.review(marker.id, marker.groupId)"
    >
      <span v-if="marker.kind === 'deleted'">已删除 {{ marker.id }}</span>
    </button>
  </div>
</template>
<script setup lang="ts">
import type { projectCanvasReviewMarkers } from '../functions/projectCanvasReviewMarkers';
import type { createCanvasAgentReview } from '../orchestration/createCanvasAgentReview';
defineProps<{ markers: ReturnType<typeof projectCanvasReviewMarkers>; review: ReturnType<typeof createCanvasAgentReview> }>();
</script>
