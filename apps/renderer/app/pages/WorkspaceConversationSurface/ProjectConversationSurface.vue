<template>
  <ConversationChatSurface
    class="project-conversation-surface"
    :variant="variant"
    :empty-composer-placement="emptyComposerPlacement"
    :is-active="isActive"
    :empty-heading="emptyHeading"
    :empty-description="startupEmptySubtitle"
    :input-placeholder="projectAssistantPlaceholder"
  >
    <template #empty-mark>
      <div class="project-chat-empty-logo">
        <LinnyaIcon class="project-chat-empty-logo-icon" />
      </div>
    </template>

    <template v-if="showHomeActions" #emptyActions>
      <button
        v-for="chip in suggestionChips"
        :key="chip.messageKey"
        class="project-chat-suggestion-chip"
        type="button"
        @click="handleSuggestionClick(chip.prompt)"
      >
        {{ conversationMessage(chip.messageKey) }}
      </button>
      <span class="project-chat-suggestion-divider" aria-hidden="true" />
      <button
        class="project-chat-suggestion-chip"
        type="button"
        @click="handleOpenKnowledgeBaseManager"
      >
        {{ conversationMessage('conversation.project.action.manageKnowledgeBase') }}
      </button>
    </template>
  </ConversationChatSurface>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { useWorkspaceProjectsStore, useWorkspaceTreeStore } from '@/domains/workspace/store';
import { useKnowledgeBaseStore } from '@/domains/knowledgebase/stores/knowledgeBase/index.js';
import { useAssistantStore } from '@/domains/conversation/store/assistantStore';
import { LinnyaIcon } from '@linnya/renderer-ui/icons';
import ConversationChatSurface from '@/domains/conversation/ui/ConversationChatSurface.vue';
import { useStartupEmptySubtitle } from '@/domains/conversation/ui/composables/useStartupEmptySubtitle';
import { useConversationLocalization } from '@/domains/conversation/ui/useConversationLocalization';
import type { ConversationMessageKey } from '@/domains/conversation/definitions/conversationMessages';
import type {
  ConversationEmptyComposerPlacement,
  ConversationSurfaceVariant,
} from '@/domains/conversation/definitions/conversationPresentation';
import { useProjectOverviewModalStore } from '@/domains/workspace/features/project-overview/store/projectOverviewModalStore';

const props = withDefaults(defineProps<{
  variant?: ConversationSurfaceVariant;
  emptyComposerPlacement?: ConversationEmptyComposerPlacement;
  isActive?: boolean;
  showHomeActions?: boolean;
}>(), {
  variant: 'regular',
  emptyComposerPlacement: 'center',
  isActive: true,
  showHomeActions: true,
});

const workspaceScopeStore = useWorkspaceScopeStore();
const projectsStore = useWorkspaceProjectsStore();
const treeStore = useWorkspaceTreeStore();
const kbStore = useKnowledgeBaseStore();
const assistantStore = useAssistantStore();
const projectOverviewModalStore = useProjectOverviewModalStore();
const startupEmptySubtitle = useStartupEmptySubtitle();
const { conversationMessage } = useConversationLocalization();

interface ProjectSuggestionChip {
  readonly messageKey: ConversationMessageKey;
  readonly prompt: string;
}

const projectId = computed(() => workspaceScopeStore.currentProjectId);
const currentProject = computed(() => {
  return projectsStore.projects.find((project) => project.id === projectId.value);
});

const emptyHeading = computed(() => (
  currentProject.value?.name || conversationMessage('conversation.project.fallbackName')
));
const projectAssistantPlaceholder = computed(() => {
  const projectName = currentProject.value?.name || conversationMessage('conversation.project.fallbackName');
  return conversationMessage('conversation.project.inputPlaceholder', { projectName });
});

const handleOpenKnowledgeBaseManager = () => {
  if (!projectId.value) return;
  projectOverviewModalStore.open({
    projectId: projectId.value,
    projectName: currentProject.value?.name ?? null,
  });
};

const suggestionChips = computed<ProjectSuggestionChip[]>(() => {
  return [
    {
      messageKey: 'conversation.project.suggestion.status',
      prompt: [
        '请你基于当前项目中可获取的信息，新建一份“项目现状诊断简报”文档。',
        '请严格按以下结构回答：',
        '1）一句话总结：用 1-2 句话概括项目当前所处阶段。',
        '2）已完成内容：列出关键里程碑、已落地功能、已验证结论。',
        '3）进行中内容：列出当前推进中的任务，并标注进度（高/中/低）。',
        '4）风险与阻塞：列出主要风险、影响范围、紧急程度，并说明触发条件。',
        '5）建议优先级：给出接下来最优先处理的 3 件事，按 P0/P1/P2 标注，并说明原因。',
        '6）缺失的信息：补充你当前缺少但会显著提升判断质量的缺失信息清单。',
      ].join('\n'),
    },
    {
      messageKey: 'conversation.project.suggestion.issues',
      prompt: [
        '仔细理解本项目的背景和目前已有的文件，从“业务目标、用户体验、技术实现、协作流程”四个维度，系统分析本项目的关键问题。',
        '请按以下格式输出：',
        '1）问题清单：列出不超过 8 个关键问题，每个问题包含“现象、可能根因、影响”。',
        '2）根因追踪：对最严重的 3 个问题做 5 Whys 根因分析。',
        '3）影响评估：说明这些问题对交付周期、质量、稳定性和用户价值的影响。',
        '4）修复策略：每个问题给出短期止损方案与中长期根治方案。',
        '5）验证方案：给出如何验证问题已被真正解决的可执行检查项。',
        '请确保结论具体、可执行，避免泛泛而谈。',
      ].join('\n'),
    },
    {
      messageKey: 'conversation.project.suggestion.plan',
      prompt: [
        '仔细理解当前项目的背景和相关文件，研究当前项目的进度，为当前项目制定一份“未来两周”的可执行行动计划。',
        '请按以下结构输出：',
        '1）目标定义：列出本阶段最重要的 3 个目标及衡量指标。',
        '2）任务拆解：按周拆分任务（第 1 周 / 第 2 周），包含负责人角色、预估工时、依赖关系。',
        '3）里程碑与验收：定义关键里程碑及验收标准（可量化）。',
        '4）风险预案：对高风险任务提供备选方案与触发条件。',
        '5）沟通节奏：建议评审频率、同步机制、必要会议与输出物。',
        '最终请附上一份“今日计划”的第一天行动清单。',
      ].join('\n'),
    },
  ];
});

const handleSuggestionClick = (prompt: string) => {
  if (!projectId.value) return;
  assistantStore.setInputText(prompt);
};

watch(
  () => props.showHomeActions,
  async (shouldLoadHomeData) => {
    if (!shouldLoadHomeData) return;
    await kbStore.ensureDataLoaded();
  },
  { immediate: true },
);

watch(
  projectId,
  async (nextProjectId) => {
    if (!nextProjectId) return;
    await treeStore.ensureProjectTreeLoaded(nextProjectId);
  },
  { immediate: true },
);
</script>
