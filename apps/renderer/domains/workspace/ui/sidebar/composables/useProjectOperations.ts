/**
 * @file useProjectOperations.ts
 * @description 项目创建和管理操作逻辑
 */
import { projectGateway } from '@/shared/ipc/projectGateway';

import { ref } from 'vue';
import { useWorkspaceLocalization } from '../../useWorkspaceLocalization';
import { resolveWorkspaceOperationFailure } from '@/domains/workspace/functions/resolveWorkspaceOperationFailure';
import { getWorkspaceOperationFailure } from '@/domains/workspace/definitions/workspaceOperationError';
import type { NotificationStore } from '@/app/notification';
import type { useWorkspaceProjectsStore } from '../../../store/WorkspaceProjectsStore';
import type { Project } from '../../../definitions/project';
import type { ProjectEditData, ProjectFormValues, ProjectOperationsOptions } from '../definitions/projectOperations';
import { refreshProjectCatalog, updateProjectCatalog } from '../../../features/project-catalog';

export function useProjectOperations(
  workspaceStore: ReturnType<typeof useWorkspaceProjectsStore>,
  notificationStore: Pick<NotificationStore, 'show'>,
  options: ProjectOperationsOptions,
) {
  const { openProjectWorkspace, startProjectPlanning, deleteProject: deleteProjectWorkspace } = options;
  const { workspaceMessage } = useWorkspaceLocalization();
  const showCreateProjectDialog = ref(false);
  const isEditMode = ref(false);
  const editProjectData = ref<ProjectEditData | null>(null);

  /**
   * 创建项目后立即保存关联草稿，进入项目对话/AI 规划时就能读到关联关系。
   * 空草稿本来就没有关联；没有知识库应用槽（插件停用）时不发写请求。
   */
  const applyProjectKnowledgeBaseLinks = async (projectId: string, kbIds: string[]) => {
    const save = options.saveProjectCreationSelection;
    if (kbIds.length === 0 || !save) return;
    try {
      await save(projectId, kbIds);
    } catch (error) {
      console.error('[useProjectOperations] 关联知识库失败:', error);
      notificationStore.show(workspaceMessage('workspace.project.operation.linkKnowledgeBaseFailed'), 'error');
    }
  };

  /**
   * 打开创建项目对话框
   */
  const promptAndCreateProject = () => {
    isEditMode.value = false;
    editProjectData.value = null;
    showCreateProjectDialog.value = true;
  };

  /**
   * 打开编辑项目对话框
   */
  const promptEditProject = () => {
    const currentProject = workspaceStore.projects.find(p => p.id === workspaceStore.activeProjectId);
    if (currentProject) {
      isEditMode.value = true;
      editProjectData.value = {
        id: currentProject.id,
        name: currentProject.name,
        description: currentProject.description || ''
      };
      showCreateProjectDialog.value = true;
    }
  };

  /**
   * 关闭项目对话框
   */
  const closeProjectDialog = () => {
    showCreateProjectDialog.value = false;
    isEditMode.value = false;
    editProjectData.value = null;
  };

  /**
   * 新建项目记录，普通创建与 AI 辅助创建共用。重名或后端拒绝时提示并返回 null。
   * 返回项目身份之后项目就已经存在：后续的关联、刷新、打开或规划失败，只能说明那一步没完成，不能再报“创建失败”。
   */
  const createProjectRecord = async (
    name: string,
    description: string
  ): Promise<{ projectId: string; projectName: string } | null> => {
    // 在调用后端之前，先在前端做一次项目名唯一性校验，避免触发数据库 UNIQUE 约束错误
    const projectName = name.trim();
    if (workspaceStore.projects.some(project => project.name === projectName)) {
      notificationStore.show(workspaceMessage('workspace.project.operation.duplicateName', { projectName }), 'error');
      return null;
    }
    try {
      const result = await projectGateway.create({ name: projectName, description: description || undefined });
      if (result.success) return { projectId: result.data.projectId, projectName };
      notificationStore.show(
        resolveWorkspaceOperationFailure(result, workspaceMessage, 'workspace.project.operation.createFailed'),
        'error'
      );
    } catch (error) {
      console.error('[useProjectOperations] 创建项目失败:', error);
      notificationStore.show(workspaceMessage('workspace.project.operation.createFailed'), 'error');
    }
    return null;
  };

  /**
   * 处理项目创建
   */
  const handleCreateProject = async ({ name, description, kbIds }: ProjectFormValues) => {
    const created = await createProjectRecord(name, description);
    if (!created) return;
    const { projectId, projectName } = created;
    notificationStore.show(workspaceMessage('workspace.project.operation.created', { projectName }), 'success');
    closeProjectDialog();

    // 先写入“创建弹窗里选择的关联知识库”，保证后续进入项目时能立刻读到；失败由它自己提示。
    await applyProjectKnowledgeBaseLinks(projectId, kbIds);

    try {
      // 已加载的列表保持挂载，正式目录刷新会按创建时间把新项目插在顶部。
      await refreshProjectCatalog();
      // 项目创建与点击既有项目共用导航：先保存并退出旧文档，再提交新项目身份。
      await openProjectWorkspace(projectId);
    } catch (error) {
      console.error('[useProjectOperations] 项目已创建，但没能打开:', error);
      notificationStore.show(workspaceMessage('workspace.project.operation.createdButOpenFailed', { projectName }), 'error');
    }
  };

  /**
   * 处理项目更新
   */
  const handleUpdateProject = async ({ name, description }: ProjectFormValues) => {
    if (!editProjectData.value) return;
    
    try {
      await updateProjectCatalog(editProjectData.value.id, {
        name,
        description
      });
      notificationStore.show(workspaceMessage('workspace.project.operation.updated'), 'success');
      closeProjectDialog();
    } catch (error) {
      console.error('[useProjectOperations] Failed to update project:', error);
      const failure = getWorkspaceOperationFailure(error);
      notificationStore.show(
        failure
          ? resolveWorkspaceOperationFailure(
            failure,
            workspaceMessage,
            'workspace.project.operation.updateFailed'
          )
          : workspaceMessage('workspace.project.operation.updateFailed'),
        'error'
      );
    }
  };

  /**
   * 统一的项目对话框确认处理
   */
  const handleProjectDialogConfirm = async (data: ProjectFormValues) => {
    if (isEditMode.value) {
      await handleUpdateProject(data);
    } else {
      await handleCreateProject(data);
    }
  };

  /**
   * 打开编辑特定项目对话框
   * @param {Object} project - 要编辑的项目对象
   */
  const promptEditSpecificProject = (project: Project) => {
    if (project) {
      isEditMode.value = true;
      editProjectData.value = {
        id: project.id,
        name: project.name,
        description: project.description || ''
      };
      showCreateProjectDialog.value = true;
    }
  };

  /**
   * 删除项目
   * @param {string} projectId - 要删除的项目 ID
   */
  const deleteProject = async (projectId: string) => {
    try {
      await deleteProjectWorkspace(projectId);
      notificationStore.show(workspaceMessage('workspace.project.operation.deleted'), 'success');
    } catch (error) {
      console.error('[useProjectOperations] Failed to delete project:', error);
      const failure = getWorkspaceOperationFailure(error);
      notificationStore.show(
        failure
          ? resolveWorkspaceOperationFailure(
            failure,
            workspaceMessage,
            'workspace.project.operation.deleteFailed'
          )
          : workspaceMessage('workspace.project.operation.deleteFailed'),
        'error'
      );
    }
  };

  /**
   * 处理 AI 辅助项目创建
   * 1. 立即创建真实项目
   * 2. 切换到项目上下文
   * 3. 在统一项目对话中开启项目初始化 Agent
   */
  const handleAiCreateProject = async ({ name, description, kbIds }: ProjectFormValues) => {
    // 1. 立即创建真实项目
    const created = await createProjectRecord(name, description);
    if (!created) return;
    const { projectId, projectName } = created;
    closeProjectDialog();

    // 先写入“关联知识库”，再进入项目/创建对话，确保后续上下文读取到最新关联
    await applyProjectKnowledgeBaseLinks(projectId, kbIds);

    // 2. 由 app 组合层统一导航并开启项目初始化 Agent。
    // 这里不能提前切 scope，否则导航会把跨项目切换误判成同项目。
    // 首条消息没有发出去时返回 false（例如没有可用模型），这时规划并没有开始。
    let planningStarted = false;
    try {
      await refreshProjectCatalog();
      planningStarted = await startProjectPlanning({ id: projectId, name: projectName, description: description || '' });
    } catch (error) {
      console.error('[useProjectOperations] 项目已创建，但 AI 辅助规划没有开始:', error);
    }
    if (planningStarted) {
      notificationStore.show(workspaceMessage('workspace.project.operation.createdWithAiPlanning', { projectName }), 'success');
    } else {
      notificationStore.show(workspaceMessage('workspace.project.operation.createdButPlanningNotStarted', { projectName }), 'warning');
    }
  };

  /**
   * 处理现有项目的 AI 初始化
   * 类似于 handleAiCreateProject，但不创建新项目
   */
  const initializeExistingProjectWithAi = async () => {
    try {
      const projectId = workspaceStore.activeProjectId;
      if (!projectId) {
         notificationStore.show(workspaceMessage('workspace.project.operation.selectProjectFirst'), 'warning');
         return;
      }
      
      const project = workspaceStore.projects.find(p => p.id === projectId);
      const projectName = project ? project.name : workspaceMessage('workspace.project.operation.currentProject');

      const planningStarted = await startProjectPlanning({
        id: projectId,
        name: projectName,
        description: project?.description ?? '',
      });
      // 首条消息没有发出去（返回 false）时规划没有开始，不能提示成功。
      if (planningStarted) {
        notificationStore.show(workspaceMessage('workspace.project.operation.aiPlanningStarted', { projectName }), 'success');
      } else {
        notificationStore.show(workspaceMessage('workspace.project.operation.aiInitFailed'), 'error');
      }
    } catch (error) {
      console.error('[useProjectOperations] AI 初始化项目失败:', error);
      notificationStore.show(workspaceMessage('workspace.project.operation.aiInitFailed'), 'error');
    }
  };

  return {
    showCreateProjectDialog,
    isEditMode,
    editProjectData,
    promptAndCreateProject,
    promptEditProject,
    promptEditSpecificProject,
    closeProjectDialog,
    handleProjectDialogConfirm,
    handleAiCreateProject,
    initializeExistingProjectWithAi,
    deleteProject,
  };
}
