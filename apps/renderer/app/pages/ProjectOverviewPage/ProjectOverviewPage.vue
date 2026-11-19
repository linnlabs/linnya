<!--
  apps/renderer/app/pages/ProjectOverviewPage/ProjectOverviewPage.vue

  项目概览页面：装配 workspace 领域的项目概览视图，并把打开文件、对话、知识库设置
  和对话的写操作（置顶、改名、删除）接到 app 层导航与对话领域。
-->
<template>
  <ProjectOverviewView
    :project-id="projectId"
    :project-name="projectName"
    :knowledge-base-count="knowledgeBaseCount"
    :knowledge-base-available="knowledgeBaseAvailable"
    :presentation="presentation"
    :conversation-actions="conversationActions"
    :running-conversation-ids="runningConversationIds"
    :conversation-history-key="conversationHistoryKey"
    @open-document="handleOpenDocument"
    @open-conversation="handleOpenConversation"
    @open-knowledge-base="handleOpenKnowledgeBase"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue';
import { useLocalization } from '@app/localization';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { useApplicationSurface, useConversationAgentChoices, useDocumentTypes } from '@/app/plugins/composables';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import {
  resolveConversationAgentChoiceTextPresentation,
  resolveDocumentTypeTextPresentation,
} from '@/app/plugins/functions/pluginContributionPresentation';
import ProjectOverviewView from '@/domains/workspace/features/project-overview/ui/ProjectOverviewView.vue';
import { resolveProjectOverviewAgentName } from '@/domains/workspace/features/project-overview/functions/projectOverviewPresentation';
import { useProjectKnowledgeBaseModalStore } from '@/domains/workspace/features/project-overview/store/projectKnowledgeBaseModalStore';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { useProjectOverviewConversations } from './orchestration/useProjectOverviewConversations';
import { useProjectOverviewDocumentNavigation } from './orchestration/useProjectOverviewDocumentNavigation';
import type {
  ProjectOverviewDocumentTarget,
  ProjectOverviewDocumentTypePresentation,
  ProjectOverviewPresentation,
} from '@/domains/workspace/features/project-overview/definitions/projectOverview';

const props = defineProps<{
  projectId: string;
}>();

const projectsStore = useWorkspaceProjectsStore();
const knowledgeBaseModalStore = useProjectKnowledgeBaseModalStore();
const knowledgeSurface = useApplicationSurface('knowledge-base');
const knowledgeBaseAvailable = computed(() => Boolean(knowledgeSurface.value?.contribution.projectAssociationComponent));
const navigation = getWorkspaceNavigationPort();
const openDocument = useProjectOverviewDocumentNavigation();
const documentTypes = useDocumentTypes();
const agentChoices = useConversationAgentChoices();
const {
  actions: conversationActions,
  runningConversationIds,
  conversationHistoryKey,
} = useProjectOverviewConversations(toRef(props, 'projectId'));
const pluginsStore = useEnabledPluginsStore();
const { t } = useLocalization();
const { workspaceMessage } = useWorkspaceLocalization();

// 文档类型和插件名从插件注册表查；注册表变化（插件启停）时整体重算。
const presentation = computed<ProjectOverviewPresentation>(() => {
  const byNodeType = new Map<string, ProjectOverviewDocumentTypePresentation>(
    documentTypes.value.map(documentType => [documentType.nodeType, {
      label: resolveDocumentTypeTextPresentation(documentType, t).label,
      iconComponent: documentType.iconComponent,
      iconClass: documentType.iconClass,
    }]),
  );
  const pluginNames = new Map(pluginsStore.states.map(state => [state.meta.id, state.meta.name]));
  const agentNames = new Map<string, string>(agentChoices.value.map(choice => [
    choice.agentId,
    resolveConversationAgentChoiceTextPresentation(choice, t).pillText,
  ]));
  return {
    documentType: nodeType => byNodeType.get(nodeType) ?? { label: nodeType, iconComponent: DocumentIcon, iconClass: '' },
    pluginName: pluginId => pluginNames.get(pluginId) ?? null,
    // 默认 Agent 不进选择器，名字由项目概览统一给出（Linnya Agent）。
    agentName: agentId => resolveProjectOverviewAgentName(agentId, agentNames, workspaceMessage),
  };
});

const projectName = computed(() => (
  projectsStore.projects.find(project => project.id === props.projectId)?.name ?? null
));
const knowledgeBaseCount = ref<number | null>(null);
let knowledgeCountRequest: AbortController | null = null;

/** 数量由知识库贡献读取；读失败显示为未知，不当成 0。换项目或插件变化时作废旧请求。 */
async function loadKnowledgeBaseCount(projectId: string): Promise<void> {
  knowledgeCountRequest?.abort();
  const count = knowledgeSurface.value?.contribution.countProjectAssociations;
  if (!knowledgeBaseAvailable.value || !count) return;
  const request = new AbortController();
  knowledgeCountRequest = request;
  try {
    const value = await count(projectId, request.signal);
    if (!request.signal.aborted) knowledgeBaseCount.value = value;
  } catch (error: unknown) {
    if (request.signal.aborted) return;
    console.error('[ProjectOverviewPage] 读取项目关联知识库失败:', error);
    knowledgeBaseCount.value = null;
  }
}

watch([() => props.projectId, knowledgeSurface], ([projectId]) => {
  knowledgeBaseCount.value = null;
  void loadKnowledgeBaseCount(projectId);
}, { immediate: true });
onBeforeUnmount(() => knowledgeCountRequest?.abort());

// 设置弹窗关闭后关联可能变了，重新读数量。
watch(() => knowledgeBaseModalStore.visible, (visible, wasVisible) => {
  if (wasVisible && !visible) void loadKnowledgeBaseCount(props.projectId);
});

function handleOpenDocument(row: ProjectOverviewDocumentTarget): void {
  void openDocument(row, props.projectId);
}

function handleOpenConversation(conversationId: string): void {
  void navigation.openConversation({
    conversationId,
    scope: { kind: 'project', projectId: props.projectId },
  });
}

function handleOpenKnowledgeBase(): void {
  if (!knowledgeBaseAvailable.value) return;
  knowledgeBaseModalStore.open({ projectId: props.projectId, projectName: projectName.value });
}
</script>
