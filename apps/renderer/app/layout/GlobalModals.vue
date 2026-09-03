<!--
  全局模态框容器组件
  
  职责：
  - 集中管理所有 Teleport 到 body 的模态框
  - 包含设置、知识库、导出设置、更新对话框等
  - 包含查找替换面板和 Citation 浮层
-->
<template>
  <Teleport to="body">
    <!-- 设置模态框 -->
    <Transition name="modal-fade">
      <SettingsModal v-if="uiStore.settingsModalVisible" />
    </Transition>
    
    <!-- 知识库模态框 (已改为页面，暂时移除) -->
    <!-- <KnowledgeBaseModal :isVisible="uiStore.isKnowledgeBaseModalVisible" /> -->
    
    <!-- 导出设置模态框 -->
    <ExportSettingsModal />
    
    <!-- 更新对话框 -->
    <UpdateDialog />

    <!-- 查找替换面板 -->
    <FindReplacePanel />

    <!-- Citation 引用面板（Phase 2 新增） -->
    <CitationPanel />

    <!-- Citation Popover（Phase 3 新增） -->
    <CitationPopover
      :visible="citationStore.popoverVisible"
      :citation-id="citationStore.popoverCitation?.citationId || ''"
      :source-id="citationStore.popoverCitation?.sourceId || ''"
      :source-type="citationStore.popoverCitation?.sourceType || 'manual'"
      :title="citationStore.popoverCitation?.title || ''"
      :snippet="citationStore.popoverCitation?.snippet || ''"
      :snippets="citationStore.popoverCitation?.snippets"
      :authors="citationStore.popoverCitation?.authors"
      :date="citationStore.popoverCitation?.date"
      :url="citationStore.popoverCitation?.url"
      :position="citationStore.popoverPosition"
      :pinned="citationStore.popoverPinned"
      @close="citationStore.closePopover"
      @edit="handleCitationEdit"
      @jump-to-source="handleJumpToSource"
    />

    <!-- Citation EditPanel（Phase 3 新增） -->
    <CitationEditPanel
      :visible="citationStore.editPanelVisible"
      :citation-id="citationStore.editPanelCitation?.citationId || ''"
      :source-id="citationStore.editPanelCitation?.sourceId || ''"
      :source-type="citationStore.editPanelCitation?.sourceType || 'manual'"
      :initial-data="citationStore.editPanelCitation"
      @close="citationStore.closeEditPanel"
      @saved="handleCitationSaved"
    />

    <!-- 全局确认对话框（替代 window.confirm，避免 Windows 下焦点丢失问题） -->
    <AlertDialog
      :visible="confirmDialogState.visible"
      :title="confirmDialogState.title"
      :message="confirmDialogState.message"
      :sections="confirmDialogState.sections"
      :risk-message="confirmDialogState.riskMessage"
      :isConfirmation="true"
      :confirmText="confirmDialogState.confirmText"
      :cancelText="confirmDialogState.cancelText"
      :width="confirmDialogState.width"
      :isDangerousAction="confirmDialogState.isDangerousAction"
      :closeIsCancel="true"
      @confirm="resolveConfirmDialog"
      @cancel="cancelConfirmDialog"
      @close="cancelConfirmDialog"
    />

    <ProjectOverviewModal
      :is-visible="projectOverviewModalStore.visible"
      :project-id="projectOverviewModalStore.projectId"
      :project-name="projectOverviewModalStore.projectName"
      @close="projectOverviewModalStore.close"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { useUIStore } from '@/shared/stores/ui';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { SettingsModal } from '@/domains/settings';
import { ExportSettingsModal } from '@/domains/workspace/features/import-export';
import { useProjectOverviewModalStore } from '@/domains/workspace/features/project-overview/store/projectOverviewModalStore';
import ProjectOverviewModal from '@/domains/workspace/features/project-overview/ui/ProjectOverviewModal.vue';
// import KnowledgeBaseModal from '@/domains/knowledgebase/ui/KnowledgeBaseModal.vue';
import UpdateDialog from '@/app/update/ui/UpdateDialog.vue';
import { FindReplacePanel } from '@/domains/editor/features/FindReplace';
import CitationPanel from '@/domains/editor/features/citation/ui/CitationPanel.vue';
import CitationPopover from '@/domains/editor/features/citation/ui/CitationPopover.vue';
import CitationEditPanel from '@/domains/editor/features/citation/ui/CitationEditPanel.vue';
import { useCitationPanelStore } from '@/domains/editor/features/citation/store/useCitationPanelStore';
import { getCitationByCitationId } from '@/domains/editor/features/citation/services/citationUpdateService';
import { projectKbLinksGateway } from '@/shared/ipc/projectKbLinksGateway';
import { knowledgeBaseService } from '@/domains/knowledgebase/services/knowledgeBaseService';
import { AlertDialog } from '@linnya/renderer-ui';
import {
  cancelConfirmDialog,
  confirmDialogState,
  resolveConfirmDialog,
} from '@/shared/composables/confirmDialog';

const uiStore = useUIStore();
const citationStore = useCitationPanelStore();
const projectOverviewModalStore = useProjectOverviewModalStore();
const workspaceScopeStore = useWorkspaceScopeStore();
const navigation = getWorkspaceNavigationPort();
/**
 * 中文说明：
 * - 由于知识库 store 是 JS 文件（历史包袱），这里通过类型守卫把交互收敛到“最小必要 API”，避免 any/类型断言。
 */
type KnowledgeBaseStoreLike = {
  ensureDataLoaded?: () => Promise<unknown>;
  setCurrentKnowledgeBase?: (kbId: string | null) => unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isFunction = (value: unknown): value is (...args: unknown[]) => unknown => {
  return typeof value === 'function';
};

const isKnowledgeBaseStoreLike = (value: unknown): value is KnowledgeBaseStoreLike => {
  if (!isRecord(value)) return false;
  const ensureDataLoadedOk =
    !('ensureDataLoaded' in value) || typeof value.ensureDataLoaded === 'function';
  const setCurrentKnowledgeBaseOk =
    !('setCurrentKnowledgeBase' in value) || typeof value.setCurrentKnowledgeBase === 'function';
  return ensureDataLoadedOk && setCurrentKnowledgeBaseOk;
};

async function getKnowledgeBaseStoreLike(): Promise<KnowledgeBaseStoreLike | null> {
  try {
    // 中文说明：动态导入，避免知识库 modal 和全局布局形成静态循环依赖。
    const mod: unknown = await import('../../domains/knowledgebase/stores/knowledgeBase.js');
    if (!isRecord(mod)) return null;

    const useStore = mod.useKnowledgeBaseStore;
    if (!isFunction(useStore)) return null;

    const store: unknown = useStore();
    if (!isKnowledgeBaseStoreLike(store)) return null;
    return store;
  } catch (error) {
    console.error('[GlobalModals] 获取 knowledgeBase store 失败:', error);
    return null;
  }
}

const normalizeDocId = (input: unknown): string | null => {
  if (!isRecord(input)) return null;
  const id = input.id;
  return typeof id === 'string' && id.trim().length > 0 ? id : null;
};

/**
 * 解析 “docId -> kbId” 映射。
 *
 * 根因说明（中文）：
 * - CitationNode 的 sourceId=docId；但在多知识库场景，一个 docId 需要 kbId 才能精确跳转。
 * - CitationNode attrs 可携带 kbId；缺少 kbId 时，这里在项目关联 KB 范围内反查。
 */
async function resolveKbIdForDocId(docId: string): Promise<string | null> {
  const cleanedDocId = docId.trim();
  if (!cleanedDocId) return null;

  // 1) 新数据：直接从当前 popover 的 citation 快照里拿 kbId（最可靠、无额外 IO）
  const kbIdFromAttrs = citationStore.popoverCitation?.kbId;
  if (typeof kbIdFromAttrs === 'string' && kbIdFromAttrs.trim().length > 0) {
    return kbIdFromAttrs;
  }

  // 2) 老数据：尝试从“当前项目关联的 KB 列表”里反查 docId 所属 kbId
  const projectId = workspaceScopeStore.currentProjectId;
  let candidateKbIds: string[] = [];

  if (typeof projectId === 'string' && projectId.trim().length > 0) {
    try {
      const result = await projectKbLinksGateway.listKnowledgeBaseIdsForProject({ projectId });
      if (result.success === true) {
        const data = result.data;
        if (Array.isArray(data)) {
          candidateKbIds = data.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
        }
      } else {
        const err =
          'error' in result && typeof result.error === 'string' ? result.error : '未知错误';
        console.warn('[GlobalModals] 获取项目关联 KB 列表失败，将回退到全量 KB:', err);
      }
    } catch (error) {
      console.warn('[GlobalModals] 反查 KB 失败（IPC 异常），将回退到全量 KB:', error);
    }
  }

  // 3) 回退：如果项目关联 KB 不可用，则遍历全部 KB（尽量保证功能可用）
  if (candidateKbIds.length === 0) {
    try {
      const all = await knowledgeBaseService.getAllKnowledgeBases();
      const list = Array.isArray(all.knowledge_bases) ? all.knowledge_bases : [];
      candidateKbIds = list
        .map((kb: unknown) => (isRecord(kb) && typeof kb.id === 'string' ? kb.id : null))
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    } catch (error) {
      console.error('[GlobalModals] 获取全量 KB 列表失败:', error);
      return null;
    }
  }

  for (const kbId of candidateKbIds) {
    try {
      const docsResponse = await knowledgeBaseService.getDocuments(kbId);
      const rawDocs = isRecord(docsResponse) ? docsResponse.documents : null;
      const docs = Array.isArray(rawDocs) ? rawDocs : [];

      for (const d of docs) {
        const id = normalizeDocId(d);
        if (id === cleanedDocId) {
          return kbId;
        }
      }
    } catch (error) {
      console.warn(`[GlobalModals] 获取 KB(${kbId}) 文档列表失败（跳过）:`, error);
    }
  }

  return null;
}

/**
 * 处理编辑引用
 */
function handleCitationEdit(citationId: string, sourceId: string) {
  const editor = uiStore.getEditor();
  if (!editor) return;

  // 获取引用数据
  const citation = getCitationByCitationId(editor.state.doc, citationId);
  if (citation) {
    citationStore.openEditPanel(citation);
  }
}

/**
 * 处理跳转到来源
 */
async function handleJumpToSource(sourceId: string) {
  /**
   * 中文说明：
   * - 这里是“查看来源”的真正落点；
   * - 之前只是 console.log，所以用户感觉“点了没反应”；
   * - 这里改为：切换到知识库页面 -> 定位到包含该 docId 的 KB（进入详情页）。
   */
  citationStore.closePopover();

  // 切换到知识库页面（内部会 ensureDataLoaded）。
  // 中文说明：来源跳转属于 app-level navigation，不直接调用 uiStore.show*。
  void navigation.openKnowledgeBase();

  const kbId = await resolveKbIdForDocId(sourceId);
  if (!kbId) {
    console.warn('[GlobalModals] 未能定位来源文档所属 KB，sourceId(docId)=', sourceId);
    return;
  }

  const kbStore = await getKnowledgeBaseStoreLike();
  if (!kbStore || typeof kbStore.setCurrentKnowledgeBase !== 'function') {
    console.warn('[GlobalModals] knowledgeBase store 不可用，无法进入具体知识库');
    return;
  }

  try {
    if (typeof kbStore.ensureDataLoaded === 'function') {
      await kbStore.ensureDataLoaded();
    }
  } catch (error) {
    console.warn('[GlobalModals] 知识库数据加载失败（继续尝试进入 KB）:', error);
  }

  kbStore.setCurrentKnowledgeBase(kbId);
}

/**
 * 处理引用保存完成
 */
function handleCitationSaved(count: number) {
  console.log(`[GlobalModals] 已更新 ${count} 处引用`);
}
</script>
