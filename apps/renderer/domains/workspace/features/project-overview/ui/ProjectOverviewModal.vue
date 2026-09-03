<template>
  <Modal
    :isVisible="isVisible"
    :title="workspaceMessage('workspace.projectOverview.title')"
    width="620px"
    maxWidth="90%"
    height="min(720px, 80vh)"
    scroll-mode="internal"
    @close="handleClose"
  >
    <div class="project-overview-modal-body">
      <div class="project-overview-title-row">
        <span class="project-overview-project-name" :title="displayProjectName">
          {{ displayProjectName }}
        </span>
        <span v-if="isStatsLoading" class="project-overview-loading-text">
          {{ workspaceMessage('workspace.projectOverview.loading') }}
        </span>
      </div>

      <div class="project-overview-stats-row">
        <div
          v-for="stat in projectStats"
          :key="stat.label"
          class="project-overview-stat-cell"
        >
          <span class="project-overview-stat-value">{{ stat.value }}</span>
          <span class="project-overview-stat-label">{{ stat.label }}</span>
        </div>
      </div>

      <p v-if="statsError" class="project-overview-error-text">
        {{ statsError }}
      </p>

      <div class="project-overview-divider" />

      <div class="project-overview-kb-section">
        <ProjectKbSettingsPanel
          v-if="activeProjectId"
          class="kb-settings-embedded"
          :project-id="activeProjectId"
          :project-name="displayProjectName"
          @close="handleClose"
        />
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Modal } from '@linnya/renderer-ui';
import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import ProjectKbSettingsPanel from '@/domains/workspace/ui/home/ProjectKbSettingsPanel.vue';
import {
  buildProjectOverviewStats,
  collectProjectDocumentNodes,
  countProjectFolders,
} from '@/domains/workspace/features/project-overview/functions/projectOverviewStats';
import { loadProjectOverviewSnapshot } from '@/domains/workspace/features/project-overview/orchestration/loadProjectOverviewSnapshot';
import type { WorkspaceNode } from '@/domains/workspace/store';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';
import { useDocumentTypes } from '@/app/plugins/composables';

const props = defineProps<{
  isVisible: boolean;
  projectId: string | null;
  projectName?: string | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { workspaceMessage } = useWorkspaceLocalization();
const registeredDocumentTypes = useDocumentTypes();

const projectTree = ref<WorkspaceNode[]>([]);
const projectTreeOwnerId = ref<string | null>(null);
const isProjectTreeLoading = ref(false);
const projectTreeError = ref<string | null>(null);
const projectCharStats = ref<{
  projectId: string | null;
  charCount: number | null;
}>({
  projectId: null,
  charCount: null,
});
const isProjectCharStatsLoading = ref(false);

let latestTreeRequestId = 0;
let latestCharStatsRequestId = 0;

const activeProjectId = computed(() => props.projectId?.trim() || '');
const displayProjectName = computed(() => {
  const projectName = props.projectName?.trim();
  return projectName && projectName.length > 0
    ? projectName
    : workspaceMessage('workspace.projectOverview.untitledProject');
});
const visibleProjectTree = computed(() => {
  if (projectTreeOwnerId.value !== activeProjectId.value) return [];
  return projectTree.value;
});
const documentNodeTypes = computed(() => new Set(registeredDocumentTypes.value.map((documentType) => documentType.nodeType)));
const documentCount = computed(() => collectProjectDocumentNodes(
  visibleProjectTree.value,
  documentNodeTypes.value,
).length);
const folderCount = computed(() => countProjectFolders(visibleProjectTree.value));
const projectCharCount = computed(() => {
  if (projectCharStats.value.projectId !== activeProjectId.value) {
    return null;
  }
  return projectCharStats.value.charCount;
});
const projectStats = computed(() => buildProjectOverviewStats({
  documentCount: documentCount.value,
  folderCount: folderCount.value,
  charCount: projectCharCount.value,
  workspaceMessage,
}));
const isStatsLoading = computed(() => isProjectTreeLoading.value || isProjectCharStatsLoading.value);
const statsError = computed(() => projectTreeError.value);

function handleClose(): void {
  emit('close');
}

async function refreshProjectTreeSnapshot(projectId: string): Promise<void> {
  const requestId = latestTreeRequestId + 1;
  latestTreeRequestId = requestId;
  isProjectTreeLoading.value = true;
  projectTreeError.value = null;

  try {
    const snapshot = await loadProjectOverviewSnapshot({
      projectId,
      gateway: workspaceGateway,
    });
    if (requestId !== latestTreeRequestId) return;

    projectTree.value = snapshot;
    projectTreeOwnerId.value = projectId;
  } catch (error) {
    if (requestId !== latestTreeRequestId) return;

    console.error('[ProjectOverviewModal] 加载项目概览文件统计失败:', error);
    projectTree.value = [];
    projectTreeOwnerId.value = projectId;
    projectTreeError.value = workspaceMessage('workspace.projectOverview.loadFailed');
  } finally {
    if (requestId === latestTreeRequestId) {
      isProjectTreeLoading.value = false;
    }
  }
}

async function refreshProjectCharCount(projectId: string): Promise<void> {
  const requestId = latestCharStatsRequestId + 1;
  latestCharStatsRequestId = requestId;
  isProjectCharStatsLoading.value = true;

  try {
    const result = await workspaceGateway['get-project-char-stats']({ projectId });
    if (requestId !== latestCharStatsRequestId) return;

    if (result.success) {
      projectCharStats.value = {
        projectId,
        charCount: result.data.charCount,
      };
      return;
    }

    projectCharStats.value = {
      projectId,
      charCount: null,
    };
  } catch (error) {
    if (requestId !== latestCharStatsRequestId) return;

    console.error('[ProjectOverviewModal] 加载项目字符统计失败:', error);
    projectCharStats.value = {
      projectId,
      charCount: null,
    };
  } finally {
    if (requestId === latestCharStatsRequestId) {
      isProjectCharStatsLoading.value = false;
    }
  }
}

function resetProjectOverviewState(): void {
  projectTree.value = [];
  projectTreeOwnerId.value = null;
  projectTreeError.value = null;
  isProjectTreeLoading.value = false;
  projectCharStats.value = {
    projectId: null,
    charCount: null,
  };
  isProjectCharStatsLoading.value = false;
}

watch(
  () => [props.isVisible, activeProjectId.value] as const,
  ([isVisible, projectId]) => {
    if (!isVisible) return;
    if (!projectId) {
      resetProjectOverviewState();
      return;
    }

    void refreshProjectTreeSnapshot(projectId);
    void refreshProjectCharCount(projectId);
  },
  { immediate: true },
);
</script>
