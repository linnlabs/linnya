// src/renderer/app/services/editorService.js
// 该文件封装了与编辑器状态和文件内容交互的核心业务逻辑。

import { nextTick } from 'vue';
import { countTextUnitsZhEn } from '../../../shared/utils/textUnits';
import { useEditorDocumentSettingsStore } from '../features/DocumentSettings';
// Pending Revisions 相关逻辑通过门面模块集中导出，保持调用方路径简洁
import { beginMarkdownDocumentSession, loadMarkdownDocumentSession } from '../features/document-session';
// 首开性能指标采集
import {
  resetOpenPerf,
  markPerf,
  measurePerf,
  setDocInfo,
  finalizeOpenPerf,
} from '../ui/services/editorOpenPerf';
import {
  getFlag,
  setLargeDocumentShellModeForOwner,
  setVirtualRootBlockRenderingActiveForOwner,
} from '../ui/services/editorFeatureFlags';
import {
  LARGE_DOCUMENT_ROOT_BLOCK_THRESHOLD,
  loadDocumentJsonAtomically,
} from './editorDocumentStateLoader';
import {
  prepareInitialRenderVirtualizationState,
  resetRenderVirtualizationBlockHeightCache,
  resetRootBlockRuntimeRegistry,
  shouldEnableVirtualRootBlockRendering,
} from '../features/RenderVirtualization/internal';
import { resetOutlinePresence } from '../features/outline/store/useOutlineRuntimeState';

// 中文备注：文本长度口径必须统一，禁止在各处复制粘贴不同实现。
// 这里统一使用 shared/utils/textUnits.ts：中文按“字”，英文/数字按“词”。

/** 装载必须可等待：文件切换直到基线、Pending 和 UI 状态全部安装后才完成。 */
export async function loadDocumentFromDatabase({ editor, stores, documentId, documentName, throwIfCancelled }) {
  const { fileStore, notificationStore, annotationStore: annotationStoreRef } = stores;
  const editorDocumentSettings = useEditorDocumentSettingsStore();
  const session = beginMarkdownDocumentSession(editor, documentId, {
    setDirty: dirty => fileStore.setDirty(dirty),
    reportError: error => notificationStore.show(error instanceof Error ? error.message : String(error), 'error', 0),
    onSnapshotInstalled: () => annotationStoreRef.value?.loadAnnotations(),
    // 每次完整快照都使用同一安装策略，刷新/提交后也不能瞬间水合整个大文档。
    loadBaseline: document => {
      const content = document.toJSON();
      const rootBlockCount = document.childCount;
      const virtual = shouldEnableVirtualRootBlockRendering({ flagEnabled: getFlag('virtualRootBlockRendering'), rootBlockCount });
      setLargeDocumentShellModeForOwner(editor, getFlag('autoRootBlockShellForLargeDocuments') && rootBlockCount >= LARGE_DOCUMENT_ROOT_BLOCK_THRESHOLD);
      setVirtualRootBlockRenderingActiveForOwner(editor, virtual.enabled);
      resetRenderVirtualizationBlockHeightCache(editor);
      resetRootBlockRuntimeRegistry(editor);
      resetOutlinePresence();
      setDocInfo({ rootBlockCount });
      loadEditorDocumentContent({ editor, content, enableVirtualRootBlockRendering: virtual.enabled });
    },
  });
  resetOpenPerf();
  markPerf('load:start');
  await nextTick();
  const installed = await loadMarkdownDocumentSession(editor, session, throwIfCancelled);
  throwIfCancelled?.();
  if (!installed) throw new Error('文档加载已被新的会话替代');
  fileStore.setFilePath(documentId, documentName);
  markPerf('load:end');
  measurePerf('load:start', 'load:end', 'totalLoadMs');
  finalizeOpenPerf();
  const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : setTimeout;
  idle(() => {
    if (!editor.isDestroyed && fileStore.currentFilePath === documentId) {
      editorDocumentSettings.setCharacterCount(countTextUnitsZhEn(editor.getText()));
    }
  });
}

/**
 * 首开文档内容加载入口。
 *
 * 中文说明：
 * - 所有完整文档先用生产 schema 严格解析，再原子切换 EditorState；
 * - 大文档只是在同一能力上增加 direct-state DOM detach 性能策略；
 * - schema 或状态切换失败会保留旧文档并直接终止，禁止回退到宽松 setContent。
 */
function loadEditorDocumentContent({
  editor,
  content,
  enableVirtualRootBlockRendering = false,
}) {
  loadDocumentJsonAtomically(editor, content, {
    prepareState: (state) => prepareInitialRenderVirtualizationState(state, {
      enabled: enableVirtualRootBlockRendering,
    }),
  });
}
