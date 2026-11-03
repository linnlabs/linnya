<template>
  <aside
    v-if="groups.length"
    class="canvas-agent-review"
    aria-label="Agent 改动组"
    @pointerdown.stop
  >
    <div
      v-for="(group, index) in groups"
      :key="group.id"
      class="canvas-agent-group"
      :class="{ active: review.state.activeGroupId.value === group.id }"
    >
      <button
        type="button"
        class="canvas-agent-group-summary"
        @click="locate(group)"
      >
        <span
          class="canvas-agent-status"
          :class="{ writing: group.writing }"
          aria-hidden="true"
        />
        <span>Agent {{ index + 1 }}<small>{{ group.writing ? '写入中' : '已静默' }}</small></span>
        <span class="canvas-agent-counts">+{{ group.added.length }} · ~{{ group.updated.length }} · −{{ group.deleted.length }}</span>
      </button>
      <template v-if="group.pendingApproval">
        <span class="canvas-approval-reason">{{ group.pendingApproval.reason === 'delete_threshold' ? '批量删除' : '大范围整理' }}待确认（{{ group.pendingApproval.operationCount }}项）</span>
        <button
          type="button"
          :disabled="busy || readonly"
          @click="review.approve(group.pendingApproval.id, 'allow')"
        >
          允许本批
        </button>
        <button
          type="button"
          :disabled="busy || readonly"
          @click="review.approve(group.pendingApproval.id, 'deny')"
        >
          拒绝
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          :disabled="busy || readonly"
          @click="review.withdraw(group.id)"
        >
          撤回本组
        </button>
        <button
          type="button"
          :disabled="busy || readonly"
          @click="review.complete(group.id)"
        >
          完成
        </button>
      </template>
    </div>
    <p
      v-if="review.state.error.value"
      role="alert"
    >
      {{ review.state.error.value }}
    </p>
    <button
      v-if="review.state.activeGroupId.value"
      type="button"
      class="canvas-review-all"
      @click="review.select(null)"
    >
      显示全部改动
    </button>
  </aside>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { CanvasAgentGroup, CanvasElementId } from '@plugin/canvas/shared';
import type { createCanvasAgentReview } from '../orchestration/createCanvasAgentReview';
const props = defineProps<{ review: ReturnType<typeof createCanvasAgentReview>; readonly?: boolean }>();
const emit = defineEmits<{ locate: [ids: readonly CanvasElementId[]] }>();
const groups = computed(() => props.review.state.groups.value);
const busy = computed(() => props.review.state.busy.value);
const locate = (group: CanvasAgentGroup) => { props.review.select(group.id); emit('locate', [...group.added, ...group.updated, ...group.deleted]); };
</script>
