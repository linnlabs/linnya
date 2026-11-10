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
import { computed, ref, toRef, watch } from 'vue';
import { useLocalization } from '@app/localization';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { useConversationAgentChoices, useDocumentTypes } from '@/app/plugins/composables';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import {
  resolveConversationAgentChoiceTextPresentation,
  resolveDocumentTypeTextPresentation,
} from '@/app/plugins/functions/pluginContributionPresentation';
import ProjectOverviewView from '@/domains/workspace/features/project-overview/ui/ProjectOverviewView.vue';
import { useProjectKnowledgeBaseModalStore } from '@/domains/workspace/features/project-overview/store/projectKnowledgeBaseModalStore';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';
import { projectKbLinksGateway } from '@/shared/ipc/projectKbLinksGateway';
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
    // 默认 Agent 不进选择器，统一叫 Linnya AI（与文件页“来源”一致）。
    agentName: agentId => (agentId === null
      ? workspaceMessage('workspace.projectOverview.actor.linnyaAi')
      : agentNames.get(agentId) ?? null),
  };
});

const projectName = computed(() => (
  projectsStore.projects.find(project => project.id === props.projectId)?.name ?? null
));
const knowledgeBaseCount = ref<number | null>(null);

async function loadKnowledgeBaseCount(projectId: string): Promise<void> {
  try {
    const result = await projectKbLinksGateway.listKnowledgeBaseIdsForProject({ projectId });
    if (projectId !== props.projectId) return;
    knowledgeBaseCount.value = result.success && Array.isArray(result.data) ? result.data.length : null;
  } catch (error: unknown) {
    console.error('[ProjectOverviewPage] 读取项目关联知识库失败:', error);
    if (projectId === props.projectId) knowledgeBaseCount.value = null;
  }
}

watch(() => props.projectId, projectId => {
  knowledgeBaseCount.value = null;
  void loadKnowledgeBaseCount(projectId);
}, { immediate: true });

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
  knowledgeBaseModalStore.open({ projectId: props.projectId, projectName: projectName.value });
}
</script>
