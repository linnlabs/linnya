<template>
  <aside
    v-if="groups.length || withdrawal"
    class="canvas-agent-review"
    aria-label="Agent 改动审阅"
    @pointerdown.stop
  >
    <section
      v-for="group in groups"
      :key="group.id"
      class="canvas-agent-group"
      :class="{ 'is-active': review.state.activeGroupId.value === group.id }"
    >
      <button type="button" class="canvas-agent-group-summary" @click="activate(group)">
        <LinnyaLoadingIcon
          v-if="group.writing"
          activity="generating"
          class="canvas-agent-status-icon"
        />
        <span v-else class="canvas-agent-status" aria-hidden="true" />
        <span class="canvas-agent-title"
          >Agent 改动 · {{ describeCanvasAgentGroupTime(group) }}</span
        >
        <span class="canvas-agent-counts">
          {{ describeCanvasAgentGroupCounts(group) }} · {{ group.writing ? '正在写入' : '已写完' }}
        </span>
      </button>
      <div class="canvas-agent-actions">
        <template v-if="group.pendingApproval">
          <span class="canvas-agent-approval">
            {{
              group.pendingApproval.reason === 'delete_threshold' ? '批量删除' : '大范围整理'
            }}待确认（{{ group.pendingApproval.operationCount }} 项）
          </span>
          <BaseButton
            variant="plain"
            size="sm"
            :disabled="busy || readonly"
            @click="review.approve(group.pendingApproval.id, 'deny')"
          >
            拒绝
          </BaseButton>
          <BaseButton
            variant="plain"
            tone="accent"
            size="sm"
            :disabled="busy || readonly"
            @click="review.approve(group.pendingApproval.id, 'allow')"
          >
            允许本批
          </BaseButton>
        </template>
        <template v-else>
          <BaseButton
            variant="plain"
            size="sm"
            :disabled="busy || readonly"
            @click="review.withdraw(group.id)"
          >
            撤回本组
          </BaseButton>
          <BaseButton
            variant="plain"
            tone="accent"
            size="sm"
            :disabled="busy || readonly"
            @click="review.complete(group.id)"
          >
            完成审阅
          </BaseButton>
        </template>
      </div>
      <details
        v-if="group.outcomes.skippedWrites.length || !group.outcomes.complete"
        class="canvas-review-details"
      >
        <summary>
          <ChevronIcon direction="right" class="canvas-review-details-arrow" aria-hidden="true" />
          跳过 {{ group.outcomes.skippedWrites.length }} 项{{
            group.outcomes.complete ? '' : '（历史信息不全）'
          }}
        </summary>
        <ul>
          <li v-for="(text, row) in projectCanvasSkippedWrites(group, elements)" :key="row">
            {{ text }}
          </li>
        </ul>
      </details>
    </section>
    <nav
      v-if="activeGroup && targets.length"
      class="canvas-review-navigation"
      aria-label="逐卡审阅"
    >
      <IconButton label="上一个改动" size="xs" :disabled="busy" @click="navigate(-1)">
        <ChevronIcon direction="left" />
      </IconButton>
      <span class="canvas-review-position">{{ position }} / {{ targets.length }}</span>
      <IconButton label="下一个改动" size="xs" :disabled="busy" @click="navigate(1)">
        <ChevronIcon direction="right" />
      </IconButton>
      <BaseButton
        variant="plain"
        size="sm"
        @click="
          emit(
            'locate',
            targets.filter(target => target.kind !== 'deleted').map(target => target.id)
          )
        "
      >
        查看整组
      </BaseButton>
      <details class="canvas-review-details">
        <summary>
          <ChevronIcon direction="right" class="canvas-review-details-arrow" aria-hidden="true" />
          改动列表
        </summary>
        <ul>
          <li v-for="target in targets" :key="target.id" class="canvas-review-target">
            <button type="button" class="canvas-panel-row" @click="reveal(target)">
              {{ target.description }} · {{ target.title }}
            </button>
            <BaseButton
              v-if="target.kind === 'deleted'"
              variant="plain"
              tone="accent"
              size="sm"
              :disabled="busy || readonly"
              @click="review.withdraw(target.groupId, [target.id])"
            >
              恢复
            </BaseButton>
          </li>
        </ul>
      </details>
    </nav>
    <div v-if="withdrawal" class="canvas-review-withdrawal" role="status">
      <span>
        {{ withdrawal.mode === 'redo' ? '重做撤回' : '撤回' }}：{{
          withdrawal.applied ? `已反转 ${withdrawal.applied} 项` : '未反转任何改动'
        }}，保留 {{ withdrawal.retained }} 项后续修改，跳过 {{ withdrawal.skipped }} 项
      </span>
      <BaseButton
        v-if="withdrawal.canRedo"
        variant="plain"
        size="sm"
        :disabled="busy || readonly"
        @click="review.redoWithdrawal()"
      >
        重做撤回
      </BaseButton>
      <details v-if="withdrawal.details.length" class="canvas-review-details">
        <summary>查看保留与跳过原因</summary>
        <ul>
          <li v-for="(detail, row) in withdrawal.details" :key="row">
            {{ detail }}
          </li>
        </ul>
      </details>
    </div>
    <p v-if="review.state.error.value" class="canvas-panel-error" role="alert">
      {{ review.state.error.value }}
    </p>
  </aside>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { BaseButton, IconButton } from '@linnya/renderer-ui';
import { ChevronIcon, LinnyaLoadingIcon } from '@linnya/renderer-ui/icons';
import {
  describeCanvasAgentGroupCounts,
  describeCanvasAgentGroupTime,
} from '../functions/describeCanvasAgentGroup';
import type { CanvasAgentGroup, CanvasElement, CanvasElementId } from '@plugin/canvas/shared';
import type { CanvasReviewTarget } from '../definitions/agentReview';
import type { createCanvasAgentReview } from '../orchestration/createCanvasAgentReview';
import { projectCanvasReviewTargets } from '../functions/projectCanvasReviewTargets';
import { projectCanvasSkippedWrites } from '../functions/projectCanvasReviewOutcome';
import { selectCanvasReviewTarget } from '../functions/selectCanvasReviewTarget';
const props = withDefaults(
  defineProps<{
    review: ReturnType<typeof createCanvasAgentReview>;
    readonly?: boolean;
    elements?: readonly CanvasElement[];
    documentTitles?: ReadonlyMap<string, string>;
  }>(),
  { elements: () => [], documentTitles: undefined }
);
const emit = defineEmits<{
  locate: [ids: readonly CanvasElementId[]];
  reveal: [target: CanvasReviewTarget];
}>();
const groups = computed(() => props.review.state.groups.value);
const activeGroup = computed(() =>
  groups.value.find(group => group.id === props.review.state.activeGroupId.value)
);
const targets = computed(() =>
  activeGroup.value
    ? projectCanvasReviewTargets(activeGroup.value, props.elements, props.documentTitles)
    : []
);
const position = computed(() =>
  Math.max(
    1,
    targets.value.findIndex(target => target.id === props.review.state.targetId.value) + 1
  )
);
const busy = computed(() => props.review.state.busy.value);
const withdrawal = computed(() => props.review.state.withdrawal.value);
function activate(group: CanvasAgentGroup) {
  props.review.select(group.id);
  const target = projectCanvasReviewTargets(group, props.elements, props.documentTitles)[0];
  if (target) reveal(target);
}
function reveal(target: CanvasReviewTarget) {
  props.review.focus(target.id);
  emit('reveal', target);
  void props.review.review(target.id, target.groupId);
}
function navigate(direction: -1 | 1) {
  const target = selectCanvasReviewTarget(
    targets.value,
    props.review.state.targetId.value,
    direction
  );
  if (target) reveal(target);
}
</script>
