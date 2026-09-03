/**
 * @file useProjectOperations.js
 * @description 项目创建和管理操作逻辑
 */

import { ref } from 'vue';
import { projectKbLinksGateway } from '../../../../../shared/ipc/projectKbLinksGateway';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { useWorkspaceLocalization } from '../../useWorkspaceLocalization';
import { resolveWorkspaceOperationFailure } from '@/domains/workspace/functions/resolveWorkspaceOperationFailure';
import { getWorkspaceOperationFailure } from '@/domains/workspace/definitions/workspaceOperationError';

export function useProjectOperations(workspaceStore, notificationStore, workspaceGateway, treeStore, options = {}) {
  const navigation = getWorkspaceNavigationPort();
  const { createProjectPlanningConversation } = options;
  const { workspaceMessage } = useWorkspaceLocalization();
  const showCreateProjectDialog = ref(false);
  const isEditMode = ref(false);
  const editProjectData = ref(null);

  const createPlanningConversation = ({ projectId, projectName }) => {
    if (typeof createProjectPlanningConversation !== 'function') {
      throw new Error('[useProjectOperations] 缺少项目规划对话创建能力');
    }

    return createProjectPlanningConversation({ projectId, projectName });
  };

  /**
   * 将“项目 ↔ 知识库关联”写入后端（统一走 IPC gateway）。
   * 说明：
   * - 创建项目后立即写入，确保进入项目对话/AI 规划时就能读到关联关系；
   * - 使用 replace 接口保证幂等与最终一致（即使用户在弹窗里多次增删）。
   */
  const applyProjectKnowledgeBaseLinks = async (projectId, kbIds) => {
    const normalizedKbIds = Array.isArray(kbIds)
      ? kbIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [];

    try {
      const result =
        await projectKbLinksGateway.replaceProjectKnowledgeBaseLinks({
          projectId,
          kbIds: normalizedKbIds
        });

      if (!result.success) {
        console.error('[useProjectOperations] 关联知识库失败:', result.error);
        notificationStore.show(workspaceMessage('workspace.project.operation.linkKnowledgeBaseFailed'), 'error');
      }
    } catch (error) {
      console.error('[useProjectOperations] 关联知识库异常:', error);
      notificationStore.show(workspaceMessage('workspace.project.operation.linkKnowledgeBaseIpcFailed'), 'error');
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
   * 处理项目创建
   */
  const handleCreateProject = async ({ name, description, kbIds }) => {
    try {
      // 在调用后端之前，先在前端做一次项目名唯一性校验，避免触发数据库 UNIQUE 约束错误
      const trimmedName = name.trim();
      const duplicated = workspaceStore.projects.some(project => project.name === trimmedName);
      if (duplicated) {
        notificationStore.show(workspaceMessage('workspace.project.operation.duplicateName', { projectName: trimmedName }), 'error');
        return;
      }

      const result = await workspaceGateway['create-project']({ 
        name: trimmedName,
        description: description || undefined
      });
      
      if (result.success) {
        notificationStore.show(workspaceMessage('workspace.project.operation.created', { projectName: name }), 'success');
        const projectId = result.data && result.data.projectId ? result.data.projectId : '';

        // 先写入“创建弹窗里选择的关联知识库”，保证后续进入项目时能立刻读到
        if (projectId) {
          await applyProjectKnowledgeBaseLinks(projectId, kbIds);
        }

        closeProjectDialog();
        await workspaceStore.loadProjects();

        // 自动进入新创建的项目
        if (projectId) {
          await workspaceStore.setActiveProject(projectId);

          // 显式加载项目树
          if (treeStore) {
            await treeStore.loadProjectTree(projectId);
          }
        }
      } else {
        notificationStore.show(
          resolveWorkspaceOperationFailure(
            result,
            workspaceMessage,
            'workspace.project.operation.createFailed'
          ),
          'error'
        );
      }
    } catch (error) {
      console.error('[useProjectOperations] Failed to create project:', error);
      notificationStore.show(workspaceMessage('workspace.project.operation.createFailed'), 'error');
    }
  };

  /**
   * 处理项目更新
   */
  const handleUpdateProject = async ({ name, description }) => {
    if (!editProjectData.value) return;
    
    try {
      await workspaceStore.updateProject(editProjectData.value.id, {
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
  const handleProjectDialogConfirm = async (data) => {
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
  const promptEditSpecificProject = (project) => {
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
  const deleteProject = async (projectId) => {
    try {
      await workspaceStore.deleteProject(projectId);
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
   * 3. 创建新对话（使用 project_planning promptKey）
   * 4. 切换到 PROJECT_SETUP 视图
   */
  const handleAiCreateProject = async ({ name, description, kbIds }) => {
    try {
      // 与普通创建保持一致：AI 辅助创建前同样做项目名唯一性检查
      const trimmedName = name.trim();
      const duplicated = workspaceStore.projects.some(project => project.name === trimmedName);
      if (duplicated) {
        notificationStore.show(workspaceMessage('workspace.project.operation.duplicateName', { projectName: trimmedName }), 'error');
        return;
      }

      // 1. 立即创建真实项目
      const result = await workspaceGateway['create-project']({ 
        name: trimmedName,
        description: description || undefined
      });
      
      if (!result.success) {
        notificationStore.show(
          resolveWorkspaceOperationFailure(
            result,
            workspaceMessage,
            'workspace.project.operation.createFailed'
          ),
          'error'
        );
        return;
      }
      
      const projectId = result.data.projectId;
      console.log('[useProjectOperations] AI 辅助创建项目成功，projectId:', projectId);

      // 先写入“关联知识库”，再进入项目/创建对话，确保后续上下文读取到最新关联
      await applyProjectKnowledgeBaseLinks(projectId, kbIds);

      // 关闭对话框
      closeProjectDialog();
      
      // 刷新项目列表
      await workspaceStore.loadProjects();
      
      // 2. 切换到项目上下文
      workspaceStore.setActiveProject(projectId);

      /**
       * 中文说明（关键）：
       * - ProjectSetup 期间，左侧工作区需要显示“AI 项目初始化”的占位卡片，而不是上一个项目遗留的文件树。
       * - app 侧边栏组合面的卡片展示条件会跟随 PROJECT_SETUP 场景和空树状态。
       * - 这里在切换 activeProject 后，立即清空树状态，避免 UI 短暂/持续展示旧项目的文件列表。
       * - 等 AI 真正创建完文件后，`ProjectSetupView` 会调用 `workspaceTreeStore.reloadActiveProjectTree()` 再刷新为新项目内容。
       */
      if (treeStore && typeof treeStore.clearTree === 'function') {
        treeStore.clearTree();
      }
      
      // 3. 创建新对话，使用 project_planning 模式
      // 对话会自动绑定到当前项目
      const conversationId = createPlanningConversation({
        projectId,
        projectName: name,
      });
      
      console.log('[useProjectOperations] 创建项目规划对话，conversationId:', conversationId);
      
      // 4. 切换到 PROJECT_SETUP 场景。
      // 中文说明：项目初始化是 app-level scene，workspace domain 只发起导航意图。
      navigation.openProjectSetup(projectId);
      
      notificationStore.show(workspaceMessage('workspace.project.operation.createdWithAiPlanning', { projectName: name }), 'success');
      
    } catch (error) {
      console.error('[useProjectOperations] AI 辅助创建项目失败:', error);
      notificationStore.show(workspaceMessage('workspace.project.operation.createFailed'), 'error');
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

      // 1. 清空当前树（UI 表现为加载/空状态，直到 AI生成）
      if (treeStore && typeof treeStore.clearTree === 'function') {
        treeStore.clearTree();
      }

      // 2. 创建新对话，使用 project_planning 模式
      const conversationId = createPlanningConversation({
        projectId,
        projectName,
      });

      console.log('[useProjectOperations] 为现有项目创建规划对话，conversationId:', conversationId);

      // 3. 切换到 PROJECT_SETUP 场景。
      navigation.openProjectSetup(projectId);

      notificationStore.show(workspaceMessage('workspace.project.operation.aiPlanningStarted', { projectName }), 'success');

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
