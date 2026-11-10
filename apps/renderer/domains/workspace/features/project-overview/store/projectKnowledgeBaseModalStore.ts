import { ref } from 'vue';
import { defineStore } from 'pinia';

interface OpenProjectKnowledgeBaseModalParams {
  projectId: string;
  projectName?: string | null;
}

/** 项目知识库设置弹窗：从项目概览页头和项目首页打开，内容仍是同一个设置面板。 */
export const useProjectKnowledgeBaseModalStore = defineStore('workspace-project-knowledge-base-modal', () => {
  const visible = ref(false);
  const projectId = ref<string | null>(null);
  const projectName = ref<string | null>(null);

  function open(params: OpenProjectKnowledgeBaseModalParams): void {
    const normalizedProjectId = params.projectId.trim();
    if (!normalizedProjectId) return;

    projectId.value = normalizedProjectId;
    projectName.value = params.projectName ?? null;
    visible.value = true;
  }

  function close(): void {
    visible.value = false;
    projectId.value = null;
    projectName.value = null;
  }

  return {
    visible,
    projectId,
    projectName,
    open,
    close,
  };
});
