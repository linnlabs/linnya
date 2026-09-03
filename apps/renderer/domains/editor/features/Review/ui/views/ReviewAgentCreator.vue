<template>
  <div class="review-section create-agent-view review-agent-creator-view">
    <div class="section-header">
      <h3>{{ titleText }}</h3>
      <button type="button" class="back-btn" @click="reviewStore.exitAgentEditor()">
        {{ editorMessage('editor.review.agentCreator.back') }}
      </button>
    </div>
    
    <div class="input-section full-height">
      <div class="field">
        <div class="field-label">{{ editorMessage('editor.review.agentCreator.nameLabel') }}</div>
        <input 
          v-model="newAgentForm.name"
          class="field-control single-line"
          :placeholder="editorMessage('editor.review.agentCreator.namePlaceholder')"
        />
      </div>

      <div class="field">
        <div class="field-label">{{ editorMessage('editor.review.agentCreator.promptLabel') }}</div>
        <textarea
          ref="promptTextarea"
          v-model="newAgentForm.systemPrompt"
          class="field-control auto-resize"
          rows="3"
          :placeholder="editorMessage('editor.review.agentCreator.promptPlaceholder')"
          @input="onPromptInput"
        />
      </div>

      <div class="field">
        <div class="field-label-row">
          <div class="field-label">{{ editorMessage('editor.review.agentCreator.knowledgeLabel') }}</div>
          <div class="field-counter" :class="{ 'is-over': isKnowledgeOverLimit }">
            {{ knowledgeUnitCount }}/{{ KNOWLEDGE_LIMIT }}
          </div>
        </div>
        <textarea
          ref="knowledgeTextarea"
          v-model="newAgentForm.knowledge"
          class="field-control auto-resize"
          rows="3"
          :placeholder="editorMessage('editor.review.agentCreator.knowledgePlaceholder')"
          @input="onKnowledgeInput"
        />
      </div>
    </div>

    <div class="action-area">
      <button 
        class="start-btn"
        :disabled="!isFormValid"
        @click="handleSaveAgent"
      >
        {{ editorMessage('editor.review.agentCreator.save') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, ref, onMounted, nextTick, watch } from 'vue';
import { useReviewStore } from '../../store/reviewStore';
import { useEditorLocalization } from '../../../../ui/useEditorLocalization';
import { applyTextareaAutoResize } from '@linnya/renderer-ui';

const reviewStore = useReviewStore();
const { editorMessage } = useEditorLocalization();
// 背景知识限制：中文按汉字计数，英文按单词计数（混合文本两者相加）
const KNOWLEDGE_LIMIT = 1500;
const TEXTAREA_MIN_HEIGHT = 38;
const PROMPT_MAX_HEIGHT = 240;
const KNOWLEDGE_MAX_HEIGHT = 300;

// Refs
const promptTextarea = ref<HTMLTextAreaElement | null>(null);
const knowledgeTextarea = ref<HTMLTextAreaElement | null>(null);

// --- 自动高度逻辑 ---
/**
 * 文本域自动高度：
 * - 未到最大高度：高度跟随内容增长，且不显示滚动条
 * - 超过最大高度：高度锁定在最大值，并开启滚动条
 */
function resizeAgentTextarea(textarea: HTMLTextAreaElement, maxHeight: number): void {
  applyTextareaAutoResize(textarea, {
    minHeight: TEXTAREA_MIN_HEIGHT,
    maxHeight,
    scrollToBottomWhenCursorAtEnd: true,
  });
}

const initAutoResize = () => {
  if (promptTextarea.value) resizeAgentTextarea(promptTextarea.value, PROMPT_MAX_HEIGHT);
  if (knowledgeTextarea.value) resizeAgentTextarea(knowledgeTextarea.value, KNOWLEDGE_MAX_HEIGHT);
};

onMounted(() => {
  nextTick(initAutoResize);
});

// --- 创建角色表单 ---
const newAgentForm = reactive({
  name: '',
  systemPrompt: '',
  knowledge: ''
});

/**
 * 编辑模式：由 store 提供 editingAgentId
 * - null => 新建
 * - string => 编辑对应的自定义角色
 */
const editingAgent = computed(() => {
  const editingId = reviewStore.editingAgentId;
  if (!editingId) return null;
  const agent = reviewStore.availableAgents.find((a) => a.id === editingId);
  return agent && agent.isCustom ? agent : null;
});

const isEditMode = computed(() => !!editingAgent.value);
const titleText = computed(() => (
  isEditMode.value
    ? editorMessage('editor.review.agentCreator.editTitle')
    : editorMessage('editor.review.agentCreator.createTitle')
));

/**
 * 将 store 中的编辑对象同步到表单
 */
const hydrateFormFromEditingAgent = () => {
  if (!editingAgent.value) {
    newAgentForm.name = '';
    newAgentForm.systemPrompt = '';
    newAgentForm.knowledge = '';
    return;
  }

  newAgentForm.name = editingAgent.value.name;
  newAgentForm.systemPrompt = editingAgent.value.systemPrompt ?? '';
  newAgentForm.knowledge = editingAgent.value.knowledge ?? '';
};

watch(
  () => [reviewStore.editingAgentId, reviewStore.availableAgents],
  () => {
    hydrateFormFromEditingAgent();
    // 数据更新后等待 DOM 渲染完成再调整高度
    nextTick(initAutoResize);
  },
  { immediate: true, deep: true }
);

/**
 * 统计“背景知识”单位数：
 * - 中文：每个汉字计 1
 * - 英文/数字：连续的单词/数字串计 1
 * - 混合：单位累加
 */
const countKnowledgeUnits = (text: string): number => {
  let units = 0;
  let inWord = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    // 汉字：一个字算一个单位，并打断英文单词状态
    if (/[\u4E00-\u9FFF]/.test(ch)) {
      units += 1;
      inWord = false;
      continue;
    }

    // 英文/数字：连续串算一个单位
    const isWordChar = /[A-Za-z0-9]/.test(ch);
    if (isWordChar) {
      if (!inWord) {
        units += 1;
        inWord = true;
      }
      continue;
    }

    // 允许单词内部出现 ' 或 -（例如 don't / state-of-the-art）
    if (inWord && (ch === '\'' || ch === '-') && i + 1 < text.length && /[A-Za-z0-9]/.test(text[i + 1])) {
      continue;
    }

    // 其它字符：结束单词
    inWord = false;
  }

  return units;
};

/**
 * 按单位数截断字符串，尽量保留原始标点/空格。
 */
const truncateKnowledgeToLimit = (text: string, limit: number): string => {
  if (limit <= 0) return '';

  let units = 0;
  let inWord = false;
  let out = '';

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    // 汉字：一个字算一个单位
    if (/[\u4E00-\u9FFF]/.test(ch)) {
      if (units + 1 > limit) break;
      units += 1;
      inWord = false;
      out += ch;
      continue;
    }

    const isWordChar = /[A-Za-z0-9]/.test(ch);
    if (isWordChar) {
      if (!inWord) {
        if (units + 1 > limit) break;
        units += 1;
        inWord = true;
      }
      out += ch;
      continue;
    }

    if (inWord && (ch === '\'' || ch === '-') && i + 1 < text.length && /[A-Za-z0-9]/.test(text[i + 1])) {
      out += ch;
      continue;
    }

    // 其它字符：不增加单位，照常保留
    inWord = false;
    out += ch;
  }

  return out;
};

const knowledgeUnitCount = computed(() => countKnowledgeUnits(newAgentForm.knowledge));
const isKnowledgeOverLimit = computed(() => knowledgeUnitCount.value > KNOWLEDGE_LIMIT);

const isFormValid = computed(() => {
  return (
    newAgentForm.name.trim() !== '' && 
    newAgentForm.systemPrompt.trim() !== '' &&
    !isKnowledgeOverLimit.value
  );
});

const handleSaveAgent = async () => {
  if (!isFormValid.value) return;
  
  // 编辑：更新已有自定义角色
  if (editingAgent.value) {
    await reviewStore.updateCustomAgent(editingAgent.value.id, {
      name: newAgentForm.name,
      systemPrompt: newAgentForm.systemPrompt,
      knowledge: newAgentForm.knowledge
    });
    return;
  }

  // 新建：新增自定义角色
  await reviewStore.addCustomAgent({
    name: newAgentForm.name,
    systemPrompt: newAgentForm.systemPrompt,
    knowledge: newAgentForm.knowledge
  });
};

// --- 输入处理（同时负责自动高度与限制） ---
const onPromptInput = (e: Event) => {
  const target = e.target;
  if (!(target instanceof HTMLTextAreaElement)) return;
  resizeAgentTextarea(target, PROMPT_MAX_HEIGHT);
};

const onKnowledgeInput = (e: Event) => {
  const target = e.target;
  if (!(target instanceof HTMLTextAreaElement)) return;

  // 强制限制单位数，避免用户一次性粘贴超长文本
  if (isKnowledgeOverLimit.value) {
    const truncated = truncateKnowledgeToLimit(newAgentForm.knowledge, KNOWLEDGE_LIMIT);
    newAgentForm.knowledge = truncated;
    // 同步到 DOM（避免高度计算基于旧值）
    target.value = truncated;
  }

  resizeAgentTextarea(target, KNOWLEDGE_MAX_HEIGHT);
};
</script>
