<!--
  apps/renderer/app/pages/ProjectOverviewPage/ProjectOverviewPage.vue

  项目概览页面：装配 workspace 领域的项目概览视图，并把打开文件、对话和知识库设置
  接到 app 层导航。
-->
<template>
  <ProjectOverviewView
    :project-id="projectId"
    :project-name="projectName"
    :knowledge-base-count="knowledgeBaseCount"
    :presentation="presentation"
    @open-document="handleOpenDocument"
    @open-conversation="handleOpenConversation"
    @open-knowledge-base="handleOpenKnowledgeBase"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useLocalization } from '@app/localization';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { useDocumentTypes } from '@/app/plugins/composables';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { resolveDocumentTypeTextPresentation } from '@/app/plugins/functions/pluginContributionPresentation';
import ProjectOverviewView from '@/domains/workspace/features/project-overview/ui/ProjectOverviewView.vue';
import { useProjectKnowledgeBaseModalStore } from '@/domains/workspace/features/project-overview/store/projectKnowledgeBaseModalStore';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store';
import { projectKbLinksGateway } from '@/shared/ipc/projectKbLinksGateway';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { useProjectOverviewDocumentNavigation } from './orchestration/useProjectOverviewDocumentNavigation';
import type {
  ProjectOverviewDocumentTypePresentation,
  ProjectOverviewPresentation,
  ProjectOverviewRow,
} from '@/domains/workspace/features/project-overview/definitions/projectOverview';

const props = defineProps<{
  projectId: string;
}>();

const projectsStore = useWorkspaceProjectsStore();
const knowledgeBaseModalStore = useProjectKnowledgeBaseModalStore();
const navigation = getWorkspaceNavigationPort();
const openDocument = useProjectOverviewDocumentNavigation();
const documentTypes = useDocumentTypes();
const pluginsStore = useEnabledPluginsStore();
const { t } = useLocalization();

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
  return {
    documentType: nodeType => byNodeType.get(nodeType) ?? { label: nodeType, iconComponent: DocumentIcon, iconClass: '' },
    pluginName: pluginId => pluginNames.get(pluginId) ?? null,
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

function handleOpenDocument(row: ProjectOverviewRow): void {
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
