import { computed, onScopeDispose, ref, watch } from 'vue';
import { showWorkspaceNotification } from '@plugin/renderer/workspaceRuntime';
import { useKnowledgeBase } from '../runtime.js';
import type { KnowledgeProjectSummary } from '../../shared';
import { knowledgeBaseService } from '../services/knowledgeBaseService';
import { readKnowledgeBaseProjectIds, replaceKnowledgeBaseProjects } from '../services/knowledgeProjectLinks';
import type { KnowledgeBaseMessageResolver } from '../definitions/knowledgeBaseMessages';

/**
 * KnowledgeBaseSettingsTab 组件的 props 类型定义
 * 单独导出，便于在 .vue 组件和组合函数之间复用。
 */
export interface KnowledgeBaseSettingsProps {
  selectedKbId: string;
}

/**
 * 知识库设置页逻辑：
 * - 管理基础信息（名称 / 描述 / 标签）的本地状态与保存
 * - 管理“项目 ↔ 知识库”的关联关系
 * - 处理删除知识库的危险操作确认逻辑
 *
 * 高内聚：所有与“知识库设置”相关的状态与行为都集中在此组合函数中。
 * 低耦合：对外仅暴露模板需要使用的计算属性与方法。
 */
export function useKnowledgeBaseSettings(
  props: KnowledgeBaseSettingsProps,
  knowledgeBaseMessage: KnowledgeBaseMessageResolver
) {
  // 使用知识库 store 以便从现有知识库列表中获取名称等信息
  const kbStore = useKnowledgeBase();

  // 使用全局通知 store，在保存成功或失败时给用户反馈

  // 使用工作区项目 store，提供“已存在项目”列表
  const allProjects = ref<KnowledgeProjectSummary[]>([]);
  const projectLinksReady = ref(false);
  const projectLinksError = ref<string | null>(null);
  let projectRequest: AbortController | null = null;
  onScopeDispose(() => projectRequest?.abort());

  // 从 store 中派生当前知识库的只读信息
  const currentKb = computed(() => {
    if (!props.selectedKbId) {
      return null;
    }

    // 这里直接使用 store 暴露的 getKnowledgeBaseById，避免 any 断言
    return kbStore.getKnowledgeBaseById
      ? kbStore.getKnowledgeBaseById(props.selectedKbId)
      : null;
  });

  // 本地可编辑状态：当前实现主要用于展示和局部编辑，后续会通过 API 回写到后端
  const localName = ref<string>('');
  const localDescription = ref<string>('');
  const localTags = ref<string[]>([]);
  const newTag = ref<string>('');
  const isSaving = ref<boolean>(false);

  // 当前知识库本地关联的项目 ID 列表（仅前端状态，尚未写入后端）
  const linkedProjectIds = ref<string[]>([]);

  // 是否正在从后端加载项目关联
  const isLoadingProjectLinks = ref<boolean>(false);

  // 已关联项目列表：用于左侧“已关联项目”列展示
  const linkedProjects = computed<KnowledgeProjectSummary[]>(() =>
    allProjects.value.filter((project) =>
      linkedProjectIds.value.includes(project.id)
    )
  );

  // 可关联项目列表：过滤掉已经关联的项目，用于右侧“可关联项目”列
  const availableProjects = computed<KnowledgeProjectSummary[]>(() =>
    allProjects.value.filter(
      (project) => !linkedProjectIds.value.includes(project.id)
    )
  );

  // 切库使上次读取失效；失败不会冒充空绑定，也不允许保存覆盖旧关系。
  const loadLinkedProjectsForKnowledgeBase = async (kbId: string) => {
    projectRequest?.abort();
    const controller = new AbortController();
    projectRequest = controller;
    projectLinksReady.value = false;
    projectLinksError.value = null;
    if (!kbId) return;
    isLoadingProjectLinks.value = true;
    try {
      const [projects, links] = await Promise.all([
        knowledgeBaseService.listProjects(controller.signal),
        readKnowledgeBaseProjectIds(kbId, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      allProjects.value = projects;
      linkedProjectIds.value = links;
      projectLinksReady.value = true;
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('[KnowledgeBaseSettings] 加载项目关联失败', error);
        projectLinksError.value = knowledgeBaseMessage('knowledgeBase.settings.error.linkProjectsFailed');
      }
    } finally {
      if (!controller.signal.aborted) isLoadingProjectLinks.value = false;
    }
  };

  // 当选中的知识库实体变化时，同步初始化本地基础信息（名称 / 描述 / 标签）
  // 注意：这里不再负责加载“关联项目”，以避免在保存时把正在编辑的关联关系覆盖掉
  watch(
    currentKb,
    (kb) => {
      if (!kb) {
        // 未选中知识库时，回退到占位示例
        localName.value = knowledgeBaseMessage('knowledgeBase.settings.placeholderName');
        localDescription.value =
          knowledgeBaseMessage('knowledgeBase.settings.placeholderDescription');
        localTags.value = [];
        return;
      }

      // 使用知识库的真实名称；无名称时给一个兜底文案
      localName.value =
        kb.name ?? knowledgeBaseMessage('knowledgeBase.settings.untitledName');

      // 使用后端返回的真实描述；如果后端暂无描述则置为空字符串，由 placeholder 提示
      localDescription.value =
        typeof kb.description === 'string' ? kb.description : '';

      localTags.value = [...(kb.tags ?? [])];
    },
    { immediate: true }
  );

  // 单独监听 selectedKbId：仅在“切换知识库”时加载 / 清空关联项目
  watch(
    () => props.selectedKbId,
    (kbId) => {
      linkedProjectIds.value = [];
      void loadLinkedProjectsForKnowledgeBase(kbId);
    },
    { immediate: true }
  );

  // 删除知识库弹窗相关状态
  const showDeleteDialog = ref(false);

  const deleteDialogMessage = computed(() => {
    const name =
      currentKb.value?.name ||
      knowledgeBaseMessage('knowledgeBase.settings.untitledName');
    return knowledgeBaseMessage('knowledgeBase.settings.deleteDialog.message', {
      knowledgeBaseName: name
    });
  });

  const openDeleteDialog = () => {
    showDeleteDialog.value = true;
  };

  const closeDeleteDialog = () => {
    showDeleteDialog.value = false;
  };

  const handleConfirmDelete = async () => {
    const kbIdToDelete = props.selectedKbId;
    if (!kbIdToDelete) {
      closeDeleteDialog();
      return;
    }

    try {
      await kbStore.deleteKnowledgeBase(kbIdToDelete);
      closeDeleteDialog();
      // 删除后重置当前选中知识库，回到列表视图
      kbStore.setCurrentKnowledgeBase(null);
      showWorkspaceNotification(
        knowledgeBaseMessage('knowledgeBase.settings.toast.deleted'),
        'success',
        3000
      );
    } catch (error) {
      console.error('[KnowledgeBaseSettingsTab] 删除知识库失败:', error);
      showWorkspaceNotification(knowledgeBaseMessage('knowledgeBase.settings.error.deleteFailed'), 'error', 4000);
      closeDeleteDialog();
    }
  };

  // 标签相关的简单操作（全部为本地前端操作）
  const handleAddTag = () => {
    const value = newTag.value.trim();
    if (!value) return;
    if (!localTags.value.includes(value)) {
      localTags.value.push(value);
    }
    newTag.value = '';
  };

  const removeTag = (tag: string) => {
    localTags.value = localTags.value.filter((t) => t !== tag);
  };

  // 将某个项目与当前知识库建立本地关联（右侧 → 左侧）
  const linkProject = (projectId: string) => {
    if (!projectId || !projectLinksReady.value) {
      return;
    }
    if (!linkedProjectIds.value.includes(projectId)) {
      linkedProjectIds.value.push(projectId);
    }
  };

  // 解除当前知识库与某个项目的本地关联（左侧 → 右侧）
  const unlinkProject = (projectId: string) => {
    if (!projectLinksReady.value) return;
    linkedProjectIds.value = linkedProjectIds.value.filter(
      (id) => id !== projectId
    );
  };

  // 将当前本地基础信息保存到后端
  const handleSaveBasicInfo = async () => {
    if (!props.selectedKbId || !currentKb.value || !projectLinksReady.value || isSaving.value) {
      return;
    }

    const kbId = props.selectedKbId;
    const controller = projectRequest;
    const projectIds = [...linkedProjectIds.value];
    try {
      isSaving.value = true;
      // 通过统一的 updateKbModelSettings 通道调用后端 PATCH /knowledge-base/:kbId/settings
      await kbStore.updateKbModelSettings(kbId, {
        // 名称：优先使用输入框的值，空字符串时回退到当前名称
        name: localName.value.trim() || currentKb.value.name,
        // 描述：允许置空，空字符串会转换为 null 存库
        description: localDescription.value || null,
        // 标签：直接传递当前前端编辑后的标签数组
        tags: [...localTags.value]
      });

      if (controller?.signal.aborted) return;
      await replaceKnowledgeBaseProjects(kbId, projectIds, controller?.signal);
      if (controller?.signal.aborted) return;

      // 保存成功后，给出全局成功提示
      showWorkspaceNotification(
        knowledgeBaseMessage('knowledgeBase.settings.toast.saved'),
        'success',
        3000
      );
    } catch (error) {
      if (controller?.signal.aborted) return;
      console.error('[KnowledgeBaseSettingsTab] 保存基础信息失败:', error);
      // 保存失败时，通过通知栏给用户明确错误反馈
      showWorkspaceNotification(knowledgeBaseMessage('knowledgeBase.settings.error.saveFailed'), 'error', 4000);
    } finally {
      isSaving.value = false;
    }
  };

  return {
    // 状态
    currentKb,
    localName,
    localDescription,
    localTags,
    newTag,
    isSaving,
    linkedProjects,
    availableProjects,
    showDeleteDialog,
    deleteDialogMessage,
    // 仅在需要用来控制 UI 行为时导出 loading 状态
    isLoadingProjectLinks,
    projectLinksReady,
    projectLinksError,
    // 操作
    handleAddTag,
    removeTag,
    linkProject,
    unlinkProject,
    openDeleteDialog,
    closeDeleteDialog,
    handleConfirmDelete,
    handleSaveBasicInfo
  };
}
