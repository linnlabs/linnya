<template>
  <aside
    v-if="groups.length || withdrawal"
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
        @click="activate(group)"
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
      <details
        v-if="group.outcomes.skippedWrites.length || !group.outcomes.complete"
        class="canvas-review-outcomes"
      >
        <summary :title="projectCanvasSkippedWrites(group, elements).join('\n')">
          跳过 {{ group.outcomes.skippedWrites.length }} 项{{ group.outcomes.complete ? '' : '（历史信息不全）' }}
        </summary>
        <ul>
          <li
            v-for="(text, row) in projectCanvasSkippedWrites(group, elements)"
            :key="row"
          >
            {{ text }}
          </li>
        </ul>
      </details>
    </div>
    <nav
      v-if="activeGroup && targets.length"
      class="canvas-review-navigation"
      aria-label="逐卡审阅"
    >
      <button
        type="button"
        :disabled="busy"
        aria-label="查看上一个改动"
        @click="navigate(-1)"
      >
        ‹
      </button>
      <span>{{ position }}/{{ targets.length }}</span>
      <button
        type="button"
        :disabled="busy"
        aria-label="查看下一个改动"
        @click="navigate(1)"
      >
        ›
      </button>
      <button
        type="button"
        @click="emit('locate', targets.filter(target => target.kind !== 'deleted').map(target => target.id))"
      >
        查看整组
      </button>
      <details class="canvas-review-deletions">
        <summary>改动卡片</summary>
        <ul>
          <li
            v-for="target in targets"
            :key="target.id"
          >
            <button
              type="button"
              @click="reveal(target)"
            >
              {{ target.description }} · {{ target.title }}
            </button>
            <button
              v-if="target.kind === 'deleted'"
              type="button"
              :disabled="busy || readonly"
              @click="review.withdraw(target.groupId, [target.id])"
            >
              恢复
            </button>
          </li>
        </ul>
      </details>
    </nav>
    <div
      v-if="withdrawal"
      class="canvas-review-withdrawal"
      role="status"
    >
      {{ withdrawal.mode === 'redo' ? '重做撤回' : '撤回' }}：{{ withdrawal.applied ? `已反转 ${withdrawal.applied} 项` : '未反转任何改动' }}，保留 {{ withdrawal.retained }} 项后续修改，跳过 {{ withdrawal.skipped }} 项
      <button
        v-if="withdrawal.canRedo"
        type="button"
        :disabled="busy || readonly"
        @click="review.redoWithdrawal()"
      >
        重做撤回
      </button>
      <details v-if="withdrawal.details.length">
        <summary :title="withdrawal.details.join('\n')">
          查看部分保留与跳过原因
        </summary><ul>
          <li
            v-for="(detail, row) in withdrawal.details"
            :key="row"
          >
            {{ detail }}
          </li>
        </ul>
      </details>
    </div>
    <p
      v-if="review.state.error.value"
      role="alert"
    >
      {{ review.state.error.value }}
    </p>
  </aside>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { CanvasAgentGroup, CanvasElement, CanvasElementId } from '@plugin/canvas/shared';
import type { CanvasReviewTarget } from '../definitions/agentReview';
import type { createCanvasAgentReview } from '../orchestration/createCanvasAgentReview';
import { projectCanvasReviewTargets } from '../functions/projectCanvasReviewTargets';
import { projectCanvasSkippedWrites } from '../functions/projectCanvasReviewOutcome';
import { selectCanvasReviewTarget } from '../functions/selectCanvasReviewTarget';
const props = withDefaults(defineProps<{ review: ReturnType<typeof createCanvasAgentReview>; readonly?: boolean; elements?: readonly CanvasElement[]; documentTitles?: ReadonlyMap<string, string> }>(), { elements: () => [], documentTitles: undefined });
const emit = defineEmits<{ locate: [ids: readonly CanvasElementId[]]; reveal: [target: CanvasReviewTarget] }>();
const groups = computed(() => props.review.state.groups.value);
const activeGroup = computed(() => groups.value.find(group => group.id === props.review.state.activeGroupId.value));
const targets = computed(() => activeGroup.value ? projectCanvasReviewTargets(activeGroup.value, props.elements, props.documentTitles) : []);
const position = computed(() => Math.max(1, targets.value.findIndex(target => target.id === props.review.state.targetId.value) + 1));
const busy = computed(() => props.review.state.busy.value);
const withdrawal = computed(() => props.review.state.withdrawal.value);
function activate(group: CanvasAgentGroup) { props.review.select(group.id); const target = projectCanvasReviewTargets(group, props.elements, props.documentTitles)[0]; if (target) reveal(target); }
function reveal(target: CanvasReviewTarget) { props.review.focus(target.id); emit('reveal', target); void props.review.review(target.id, target.groupId); }
function navigate(direction: -1 | 1) { const target = selectCanvasReviewTarget(targets.value, props.review.state.targetId.value, direction); if (target) reveal(target); }
</script>
