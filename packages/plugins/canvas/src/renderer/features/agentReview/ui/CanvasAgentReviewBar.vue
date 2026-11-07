<template>
  <!-- 收起时只占底部一行（与缩放条同高）：摘要、逐卡翻页、完成审阅；时间、改动列表、撤回与跳过说明在向上展开的面板里。 -->
  <div
    v-if="groups.length || withdrawal"
    class="canvas-agent-review"
    @pointerdown.stop
    @keydown.esc="expanded = false"
  >
    <section
      v-if="expanded"
      :id="panelId"
      class="canvas-agent-review-panel"
      aria-label="Agent 改动详情"
    >
      <p v-if="error" class="canvas-panel-error canvas-agent-review-error" role="alert">
        {{ error }}
      </p>
      <div v-if="withdrawal" class="canvas-review-withdrawal" role="status">
        <span>
          {{ withdrawal.mode === 'redo' ? '重做撤回' : '撤回' }}：{{
            withdrawal.applied ? `已反转 ${withdrawal.applied} 项` : '未反转任何改动'
          }}，保留 {{ withdrawal.retained }} 项后续修改，跳过 {{ withdrawal.skipped }} 项
        </span>
        <BaseButton
          v-if="withdrawal.canRedo && groups.length"
          variant="plain"
          size="sm"
          :disabled="busy || readonly"
          @click="review.redoWithdrawal()"
        >
          重做撤回
        </BaseButton>
        <details v-if="withdrawal.details.length" class="canvas-review-details">
          <summary>
            <ChevronIcon direction="right" class="canvas-review-details-arrow" aria-hidden="true" />
            查看保留与跳过原因
          </summary>
          <ul>
            <li v-for="(detail, row) in withdrawal.details" :key="row">
              {{ detail }}
            </li>
          </ul>
        </details>
      </div>
      <div v-if="groups.length > 1" class="canvas-agent-groups">
        <button
          v-for="group in groups"
          :key="group.id"
          type="button"
          class="canvas-panel-row"
          :class="{ 'is-active': activeGroup?.id === group.id }"
          :aria-current="activeGroup?.id === group.id ? 'true' : undefined"
          @click="activate(group)"
        >
          <span class="canvas-panel-row-title"
            >Agent 改动 · {{ describeCanvasAgentGroupTime(group) }}</span
          >
          <small>{{ describeGroupState(group) }}</small>
        </button>
      </div>
      <template v-if="activeGroup">
        <header v-if="groups.length === 1" class="canvas-agent-review-head">
          <span class="canvas-agent-title">Agent 改动</span>
          <span class="canvas-agent-meta">
            {{ describeCanvasAgentGroupTime(activeGroup) }} ·
            {{ activeGroup.writing ? '正在写入' : '已写完' }}
          </span>
        </header>
        <ul v-if="targets.length" class="canvas-panel-list canvas-review-targets">
          <li v-for="target in targets" :key="target.id" class="canvas-review-target">
            <button
              type="button"
              class="canvas-panel-row"
              :class="{ 'is-active': target.id === review.state.targetId.value }"
              :title="`${target.description} · ${target.title}`"
              @click="reveal(target)"
            >
              <span class="canvas-review-target-kind">{{ kindLabels[target.kind] }}</span>
              <span class="canvas-review-target-title">{{ target.title }}</span>
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
        <details
          v-if="activeGroup.outcomes.skippedWrites.length || !activeGroup.outcomes.complete"
          class="canvas-review-details"
        >
          <summary>
            <ChevronIcon direction="right" class="canvas-review-details-arrow" aria-hidden="true" />
            跳过 {{ activeGroup.outcomes.skippedWrites.length }} 项{{
              activeGroup.outcomes.complete ? '' : '（历史信息不全）'
            }}
          </summary>
          <ul>
            <li v-for="(text, row) in projectCanvasSkippedWrites(activeGroup, elements)" :key="row">
              {{ text }}
            </li>
          </ul>
        </details>
        <footer class="canvas-agent-review-foot">
          <BaseButton
            v-if="targets.length"
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
          <BaseButton
            v-if="!activeGroup.pendingApproval"
            variant="plain"
            size="sm"
            :disabled="busy || readonly"
            @click="review.withdraw(activeGroup.id)"
          >
            撤回本组
          </BaseButton>
        </footer>
      </template>
    </section>
    <div class="canvas-agent-review-bar" role="toolbar" aria-label="Agent 改动审阅">
      <button
        type="button"
        class="canvas-agent-review-summary"
        :class="{ 'is-warning': approval }"
        :aria-expanded="expanded"
        :aria-controls="expanded ? panelId : undefined"
        @click="expanded = !expanded"
      >
        <LinnyaLoadingIcon
          v-if="!approval && activeGroup?.writing"
          activity="generating"
          class="canvas-agent-status-icon"
        />
        <span v-else-if="!approval && activeGroup" class="canvas-agent-status" aria-hidden="true" />
        <span class="canvas-agent-summary-text">{{ summary }}</span>
        <ChevronIcon
          :direction="expanded ? 'down' : 'up'"
          class="canvas-agent-summary-arrow"
          aria-hidden="true"
        />
      </button>
      <template v-if="approval">
        <BaseButton
          variant="plain"
          size="sm"
          :disabled="busy || readonly"
          @click="review.approve(approval.id, 'deny')"
        >
          拒绝
        </BaseButton>
        <BaseButton
          variant="plain"
          tone="accent"
          size="sm"
          :disabled="busy || readonly"
          @click="review.approve(approval.id, 'allow')"
        >
          允许本批
        </BaseButton>
      </template>
      <template v-else-if="activeGroup">
        <template v-if="targets.length">
          <span class="canvas-agent-review-divider" aria-hidden="true" />
          <ToolbarButton label="上一个改动" :disabled="busy" @click="navigate(-1)">
            <ChevronIcon direction="left" />
          </ToolbarButton>
          <span class="canvas-review-position">{{ position }} / {{ targets.length }}</span>
          <ToolbarButton label="下一个改动" :disabled="busy" @click="navigate(1)">
            <ChevronIcon direction="right" />
          </ToolbarButton>
        </template>
        <span class="canvas-agent-review-divider" aria-hidden="true" />
        <BaseButton
          variant="plain"
          tone="accent"
          size="sm"
          :disabled="busy || readonly"
          @click="review.complete(activeGroup.id)"
        >
          完成审阅
        </BaseButton>
      </template>
      <BaseButton
        v-else-if="withdrawal?.canRedo"
        variant="plain"
        size="sm"
        :disabled="busy || readonly"
        @click="review.redoWithdrawal()"
      >
        重做撤回
      </BaseButton>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { BaseButton, ToolbarButton } from '@linnya/renderer-ui';
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
const kindLabels: Readonly<Record<CanvasReviewTarget['kind'], string>> = {
  added: '新增',
  updated: '修改',
  deleted: '删除',
};
const panelId = `canvas-agent-review-${useId()}`;
const expanded = ref(false);
const groups = computed(() => props.review.state.groups.value);
const activeGroup = computed(() =>
  groups.value.find(group => group.id === props.review.state.activeGroupId.value)
);
/** Agent 正停下等确认的批次必须在收起态直接可答，优先当前组。 */
const approval = computed(
  () =>
    activeGroup.value?.pendingApproval ??
    groups.value.find(group => group.pendingApproval)?.pendingApproval ??
    null
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
const error = computed(() => props.review.state.error.value);
const withdrawal = computed(() => props.review.state.withdrawal.value);
const summary = computed(() => {
  if (approval.value)
    return `${approval.value.reason === 'delete_threshold' ? '批量删除' : '大范围整理'}待确认（${approval.value.operationCount} 项）`;
  if (activeGroup.value)
    return `Agent ${describeCanvasAgentGroupCounts(activeGroup.value)}${groups.value.length > 1 ? ` · 共 ${groups.value.length} 组` : ''}`;
  const result = withdrawal.value;
  if (!result) return '';
  if (result.mode === 'redo') return '已重做撤回';
  return result.applied ? `已撤回 ${result.applied} 项` : '未撤回任何改动';
});
// 审阅动作失败时展开面板给出原因；条目全部消失后下次出现仍从收起态开始。
watch(error, message => {
  if (message) expanded.value = true;
});
watch(
  () => groups.value.length > 0 || withdrawal.value !== null,
  visible => {
    if (!visible) expanded.value = false;
  }
);
function describeGroupState(group: CanvasAgentGroup): string {
  return `${describeCanvasAgentGroupCounts(group)} · ${group.writing ? '正在写入' : '已写完'}`;
}
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
