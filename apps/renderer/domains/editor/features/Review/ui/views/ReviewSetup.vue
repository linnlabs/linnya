<template>
  <div class="review-section setup-view review-setup-view">
    <div class="section-title">
      <div class="title-content">
        <h3>{{ editorMessage('editor.review.setup.title') }}</h3>
        <p class="subtitle">{{ editorMessage('editor.review.setup.subtitle') }}</p>
      </div>
      <button 
        v-if="historyCount > 0"
        class="history-entry-btn"
        @click="reviewStore.setStatus('results')"
      >
        {{ editorMessage('editor.review.setup.historyEntry', { count: historyCount }) }}
      </button>
    </div>

    <!-- 已选角色列表 -->
    <div class="selected-agents-list">
      <div class="list-label">
        {{ editorMessage('editor.review.setup.selectedAgents', { count: reviewStore.selectedAgents.length }) }}
      </div>
      
      <div 
        v-for="agent in reviewStore.selectedAgents" 
        :key="agent.id"
        class="selected-agent-card"
      >
        <div class="agent-content">
          <div class="agent-name">{{ readAgentName(agent) }}</div>
          <!-- 如果有背景知识，显示一个小标记 -->
          <div
            v-if="agent.knowledge"
            class="agent-badge-info"
            :title="editorMessage('editor.review.setup.knowledgeBadge')"
          >
            {{ editorMessage('editor.review.setup.knowledgeBadge') }}
          </div>
        </div>
        <div class="agent-actions">
          <button
            v-if="agent.isCustom"
            type="button"
            class="icon-btn"
            :title="editorMessage('editor.review.setup.editAgent')"
            @click="reviewStore.beginEditCustomAgent(agent.id)"
          >
            <EditIcon />
          </button>
          <button
            type="button"
            class="icon-btn"
            :title="editorMessage('editor.review.setup.removeAgent')"
            @click="reviewStore.removeAgent(agent.id)"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <!-- 添加角色下拉框 -->
      <div v-if="reviewStore.selectedAgents.length < 3" class="add-agent-wrapper">
        <AddIcon class="add-agent-icon" />
        <CustomSelect
          class="review-agent-select"
          :modelValue="null"
          :options="agentOptions"
          :placeholder="editorMessage('editor.review.setup.addAgentPlaceholder')"
          :bordered="true"
          :class-names="{
            trigger: 'review-agent-select-trigger',
            selectedValue: 'review-agent-select-value',
            options: 'review-agent-select-options',
          }"
          @update:modelValue="handleAgentSelect"
        >
          <template #arrow-icon="{ isOpen }">
            <ChevronIcon direction="down" class="select-chevron" :class="{ 'is-open': isOpen }" />
          </template>
        </CustomSelect>
      </div>
    </div>

    <!-- 审阅背景与目标 -->
    <div class="input-section">
      <div class="field">
        <div class="field-label">{{ editorMessage('editor.review.setup.backgroundLabel') }}</div>
        <textarea
          ref="backgroundTextarea"
          class="field-control auto-resize"
          :value="reviewStore.reviewBackground"
          rows="1"
          :placeholder="editorMessage('editor.review.setup.backgroundPlaceholder')"
          @input="onBackgroundInput"
        />
      </div>

      <div class="field">
        <div class="field-label">{{ editorMessage('editor.review.setup.goalLabel') }}</div>
        <textarea
          ref="goalTextarea"
          class="field-control auto-resize"
          :value="reviewStore.reviewGoal"
          rows="1"
          :placeholder="editorMessage('editor.review.setup.goalPlaceholder')"
          @input="onGoalInput"
        />
      </div>
    </div>

    <div class="action-area">
      <button 
        class="start-btn"
        :disabled="reviewStore.activeAgentIds.length === 0"
        @click="reviewStore.startReview()"
      >
        {{ editorMessage('editor.review.setup.start') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch } from 'vue';
import type { Component } from 'vue';
import { useReviewStore } from '../../store/reviewStore';
import { useUIStore } from '@shared/stores/ui';
import { CustomSelect } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import { AddIcon } from '@linnya/renderer-ui/icons';
import { EditIcon } from '@linnya/renderer-ui/icons';
import type { ReviewAnnotation } from '../../types/reviewAnnotation';
import { useEditorLocalization } from '../../../../ui/useEditorLocalization';
import { readReviewAgentName } from '../../functions/reviewAgentPresentation';
import type { ReviewAgent } from '../../definitions/reviewAgent';
import { applyTextareaAutoResize } from '@linnya/renderer-ui';

const reviewStore = useReviewStore();
const uiStore = useUIStore();
const { editorMessage } = useEditorLocalization();
const backgroundTextarea = ref<HTMLTextAreaElement | null>(null);
const goalTextarea = ref<HTMLTextAreaElement | null>(null);

// 检查是否存在历史审阅结果
const editorInstance = computed(() => uiStore.getEditor());
const annotationStore = computed(() => editorInstance.value?.annotationStore);

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const readAnnotationList = (store: unknown): readonly unknown[] => {
  if (!isObjectRecord(store)) return [];

  const annotationsRef = store.annotations;
  if (!isObjectRecord(annotationsRef)) return [];

  const annotations = annotationsRef.value;
  return Array.isArray(annotations) ? annotations : [];
};

const isReviewAnnotation = (annotation: unknown): annotation is ReviewAnnotation => {
  if (!isObjectRecord(annotation)) return false;
  const meta = annotation.meta;
  if (!isObjectRecord(meta)) return false;
  return meta.source === 'review';
};

const historyCount = computed(() => {
  return readAnnotationList(annotationStore.value).filter(isReviewAnnotation).length;
});

// --- 自动高度逻辑 ---
const TEXTAREA_MIN_HEIGHT = 60;
const TEXTAREA_MAX_HEIGHT = 200;

/**
 * 文本域自动高度：
 * - 未到最大高度：高度跟随内容增长，且不显示滚动条
 * - 超过最大高度：高度锁定在最大值，并开启滚动条
 */
function resizeReviewTextarea(textarea: HTMLTextAreaElement): void {
  applyTextareaAutoResize(textarea, {
    minHeight: TEXTAREA_MIN_HEIGHT,
    maxHeight: TEXTAREA_MAX_HEIGHT,
    scrollToBottomWhenCursorAtEnd: true,
  });
}

// 初始化和变化时调整高度
const initAutoResize = () => {
  if (backgroundTextarea.value) resizeReviewTextarea(backgroundTextarea.value);
  if (goalTextarea.value) resizeReviewTextarea(goalTextarea.value);
};

onMounted(() => {
  nextTick(initAutoResize);
});

// 监听 store 值变化也要调整（比如切换回来时）
watch(
  () => [reviewStore.reviewBackground, reviewStore.reviewGoal],
  () => nextTick(initAutoResize)
);

// --- 交互逻辑 ---

type CustomSelectOption =
  | { isGroup: true; label: string }
  | { text: string; value: string; iconComponent?: Component }
  | { isSeparator: true };

const readAgentName = (agent: ReviewAgent) => readReviewAgentName(agent, editorMessage);

const systemAgents = computed(() => reviewStore.selectableAgents.filter((a) => !a.isCustom));
const customAgents = computed(() => reviewStore.selectableAgents.filter((a) => !!a.isCustom));

// 构造给 CustomSelect 使用的选项列表（禁止逃避类型系统，显式建模）
const agentOptions = computed<CustomSelectOption[]>(() => {
  const system = systemAgents.value;
  const custom = customAgents.value;

  const options: CustomSelectOption[] = [];

  // 系统角色分组
  options.push({ isGroup: true, label: editorMessage('editor.review.setup.systemAgentsGroup') });
  system.forEach((agent) => {
    options.push({ text: readAgentName(agent), value: agent.id });
  });

  // 两组之间加分隔线（与 ModelConfig 的分组体验一致）
  options.push({ isSeparator: true });

  // 自定义角色分组
  options.push({ isGroup: true, label: editorMessage('editor.review.setup.customAgentsGroup') });
  custom.forEach((agent) => {
    options.push({ text: readAgentName(agent), value: agent.id });
  });
  // “新建”固定放在自定义角色组里最后
  options.push({
    text: editorMessage('editor.review.setup.createCustomAgent'),
    value: '__create_new__',
    iconComponent: AddIcon,
  });

  return options;
});

const handleAgentSelect = (value: string | number | null) => {
  if (!value) return;
  
  if (value === '__create_new__') {
    reviewStore.beginCreateCustomAgent();
  } else {
    reviewStore.selectAgent(value as string);
  }
};

// --- 输入处理 ---
const onBackgroundInput = (e: Event) => {
  const target = e.target;
  if (!(target instanceof HTMLTextAreaElement)) return;
  reviewStore.setReviewBackground(target.value);
  resizeReviewTextarea(target);
};

const onGoalInput = (e: Event) => {
  const target = e.target;
  if (!(target instanceof HTMLTextAreaElement)) return;
  reviewStore.setReviewGoal(target.value);
  resizeReviewTextarea(target);
};
</script>
