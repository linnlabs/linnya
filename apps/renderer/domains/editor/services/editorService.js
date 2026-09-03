// src/renderer/app/services/editorService.js
// 该文件封装了与编辑器状态和文件内容交互的核心业务逻辑。

import { nextTick } from 'vue';
import { workspaceGateway } from '../../../shared/ipc/workspaceGateway';
import { countTextUnitsZhEn } from '../../../shared/utils/textUnits';
import { useEditorDocumentSettingsStore } from '../features/DocumentSettings';
// Pending Revisions 相关逻辑通过门面模块集中导出，保持调用方路径简洁
import { useRevisionStore } from '../features/Revision';
// Markdown 导入统一走 markdownConversion 门面，不再直接引用底层 WASM / converter
import { importMarkdownToDocJson } from './markdownConversion';
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
  countRootBlocksInDocJson,
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
import { resolveCurrentEditorMessage } from '../functions/resolveCurrentEditorMessage';

// 中文备注：文本长度口径必须统一，禁止在各处复制粘贴不同实现。
// 这里统一使用 shared/utils/textUnits.ts：中文按“字”，英文/数字按“词”。

// 定义一个静态的初始内容结构，当加载文件失败或文件为空时使用。
const initialContent = {
  type: 'doc',
  content: [
    {
      type: 'rootBlock',
      content: [
        {
          type: 'baseBlock',
          attrs: {
            blockType: 'base',
          },
          content: []
        }
      ]
    }
  ]
};

/**
 * 收集编辑器当前内容和状态以供保存。
 * @param {import('@tiptap/vue-3').Editor} editor - Tiptap 编辑器实例。
 * @param {object} annotationStore - 批注存储实例。
 * @returns {object|null} - 返回可被序列化的数据对象，或在失败时返回 null。
 */
export function gatherSaveData(editor, annotationStore) {
  if (!editor) {
    console.error('[EditorService] 无法收集保存数据：编辑器实例不存在。');
    return null;
  }
  const editorContent = editor.getJSON();
  const currentAnnotations = annotationStore ? annotationStore.getCurrentAnnotations() : [];
  if (!annotationStore) {
    console.warn('[EditorService] 无法收集批注：批注存储实例不存在。');
  }
  
  return { version: 1, editorContent, annotations: currentAnnotations };
}

/**
 * [新] 将从数据库获取的数据加载到编辑器中
 * @param {object} params
 * @param {import('@tiptap/vue-3').Editor} params.editor - Tiptap 编辑器实例
 * @param {object} params.stores - 包含所有 Pinia store 的对象
 * @param {object} params.documentData - 从后端获取的完整文档数据
 * @param {object} params.documentData.documentInfo - 文档元数据，如 { id, name }
 * @param {object} params.documentData.content - 文档的 ProseMirror JSON 内容
 * @param {Array} params.documentData.annotations - 文档的批注数组
 * @param {Array} [params.documentData.pendingRevisions] - AI 修订意图数组（冷启动时应用）
 */
export function loadDocumentFromDatabase({ editor, stores, documentData }) {
  const { fileStore, notificationStore, annotationStore: annotationStoreRef } = stores;
  const editorDocumentSettings = useEditorDocumentSettingsStore();
  const { documentInfo, content, annotations, pendingRevisions } = documentData;

  console.log(`[EditorService] 正在从数据库加载文档: ${documentInfo.id}`);

  if (!editor || editor.isDestroyed) {
    console.warn('[EditorService] 编辑器未初始化或已销毁，无法加载内容。');
    return;
  }

  // 性能采集：重置并开始计时
  resetOpenPerf();
  markPerf('load:start');

  // 采集文档维度信息（在异步链路之前，避免影响计时）
  const rootBlockCount = countRootBlocksInDocJson(content);
  const shouldUseLargeDocumentShell =
    getFlag('autoRootBlockShellForLargeDocuments') &&
    rootBlockCount >= LARGE_DOCUMENT_ROOT_BLOCK_THRESHOLD;
  setLargeDocumentShellModeForOwner(editor, shouldUseLargeDocumentShell);
  const virtualRenderDecision = shouldEnableVirtualRootBlockRendering({
    flagEnabled: getFlag('virtualRootBlockRendering'),
    rootBlockCount,
  });
  setVirtualRootBlockRenderingActiveForOwner(editor, virtualRenderDecision.enabled);
  resetRenderVirtualizationBlockHeightCache(editor);
  resetRootBlockRuntimeRegistry(editor);

  setDocInfo({
    rootBlockCount,
    hasPendingRevisions: Array.isArray(pendingRevisions) && pendingRevisions.length > 0,
    pendingRevisionCount: Array.isArray(pendingRevisions) ? pendingRevisions.length : 0,
  });

  nextTick(() => {
    // 使用 IIFE 支持异步逻辑（首开 Markdown 解析）
    (async () => {
      try {
        let finalContent = content;

        // 1. 加载 / 规范化文档内容
        if (content) {
          // 预置：在加载前重置目录运行期状态，避免从有目录切到无目录时残留。
          try {
            resetOutlinePresence();
          } catch (e) {
            // 忽略 UI 状态错误，避免影响文档加载
            console.warn('[EditorService] 重置目录状态失败：', e);
          }

          // 尝试执行一次性的 Markdown 首开解析（仅当内容包含 rawMarkdownSource 占位标记时）
          markPerf('markdownNormalize:start');
          const normalizeResult = await maybeNormalizeMarkdownContentWithWasm({
            editor,
            rawContent: content,
            documentId: documentInfo.id
          });
          markPerf('markdownNormalize:end');
          measurePerf('markdownNormalize:start', 'markdownNormalize:end', 'markdownNormalizeMs');
          finalContent = normalizeResult.content;

          // 如果发生了迁移但回写失败，需要将文档标记为 dirty，以便后续自动保存能生效
          if (normalizeResult.dirty) {
            console.warn('[EditorService] 文档首开迁移回写失败，标记为 dirty 以便后续保存。');
            // 注意：这里只是记录状态，真正的 setDirty 会在下方统一处理
          }

          loadEditorDocumentContent({
            editor,
            content: finalContent,
            enableVirtualRootBlockRendering: virtualRenderDecision.enabled,
          });
        } else {
          loadEditorDocumentContent({
            editor,
            content: initialContent,
            enableVirtualRootBlockRendering: false,
          });
          console.warn(`[EditorService] 文档 ${documentInfo.id} 内容为空，已重置为初始内容。`);
        }

        // 2. 加载批注
        const realAnnotationStore = annotationStoreRef.value;
        if (realAnnotationStore && typeof realAnnotationStore.loadAnnotations === 'function') {
          realAnnotationStore.loadAnnotations(annotations || []);
          console.log('[EditorService] 批注已成功加载。');
        } else {
          console.warn('[EditorService] annotationStore.loadAnnotations 不可用，无法加载批注。');
        }

        // 2.5 触发文件内容加载事件，通知诸如目录侧边栏立即重建
        try {
          if (editor.eventBus && typeof editor.eventBus.emit === 'function') {
            editor.eventBus.emit('file-content-loaded');
          }
        } catch (e) {
          console.warn('[EditorService] 触发 file-content-loaded 事件失败：', e);
        }

        // 2.6 注入 Pending Revisions（AI 修订意图）
        // 重要：pending 是块级 metadata（类似 annotation/history），只允许“渲染”，不能写入正文结构；
        // 否则自动保存会把 revisionMark/插入文本写回 content_json，破坏 pending 语义。
        if (pendingRevisions && pendingRevisions.length > 0) {
          try {
            console.log(
              `[EditorService] 发现 ${pendingRevisions.length} 个 pending revisions，注入 RevisionStore...`
            );
            markPerf('pendingInject:start');
            const revisionStore = useRevisionStore(editor);
            revisionStore.setWorkspacePendingRevisions(pendingRevisions);
            try {
              if (editor.eventBus && typeof editor.eventBus.emit === 'function') {
                editor.eventBus.emit('pending-revisions-loaded');
              }
            } catch (eventError) {
              console.warn('[EditorService] 触发 pending-revisions-loaded 事件失败：', eventError);
            }
            markPerf('pendingInject:end');
            measurePerf('pendingInject:start', 'pendingInject:end', 'pendingRevisionInjectMs');
          } catch (e) {
            console.warn('[EditorService] 注入 pending revisions 失败：', e);
          }
        }

        // 3. 更新文件状态
        // 重要：currentFilePath 现在存储的是 documentId
        fileStore.setFilePath(documentInfo.id, documentInfo.name);
        
        // 根据迁移结果设置 dirty 状态
        // 如果 normalizeResult.dirty 为 true，说明内存与 DB 不一致，必须设为 true
        fileStore.setDirty(typeof normalizeResult !== 'undefined' && normalizeResult.dirty === true);

        // 性能采集：记录总耗时并输出报告（在字符统计之前，避免 getText 拖慢首开指标）
        markPerf('load:end');
        measurePerf('load:start', 'load:end', 'totalLoadMs');
        finalizeOpenPerf();

        // 4. 更新UI状态：字符统计延迟到浏览器空闲时执行，不阻塞首屏渲染
        // getText() 需遍历整棵文档树，对千行文档开销 ~50-100ms
        const idleCb = typeof requestIdleCallback === 'function' ? requestIdleCallback : setTimeout;
        idleCb(() => {
          if (editor.isDestroyed) return;
          const plainText = editor.getText();
          const units = countTextUnitsZhEn(plainText);
          editorDocumentSettings.setCharacterCount(units);
        });
      } catch (error) {
        console.error(
          `[EditorService] 加载文档 ${documentInfo.id} 到编辑器时出错:`,
          error
        );
        notificationStore.show(
          resolveCurrentEditorMessage('editor.service.loadFileFailed'),
          'error'
        );
      }
    })();
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


/**
 * 将文件数据加载到编辑器中。
 * @param {object} params
 * @param {import('@tiptap/vue-3').Editor} params.editor - Tiptap 编辑器实例。
 * @param {object} params.stores - 包含所有必需 Pinia store 的对象。
 * @param {object} params.fileInfo - 包含 `filePath`, `fileName` 和 `data` 的文件信息对象。
 */
export function loadContentIntoEditor({ editor, stores, fileInfo }) {
  const { fileStore, notificationStore, annotationStore: annotationStoreRef } = stores;
  const editorDocumentSettings = useEditorDocumentSettingsStore();
  const { filePath, fileName, data } = fileInfo;

  console.log(`[EditorService] 正在为路径加载内容: ${filePath}`);
  
  if (!editor || editor.isDestroyed) {
    console.warn('[EditorService] 编辑器未初始化或已销毁，无法加载内容。');
    return;
  }
  setVirtualRootBlockRenderingActiveForOwner(editor, false);
  resetRenderVirtualizationBlockHeightCache(editor);
  resetRootBlockRuntimeRegistry(editor);
  
    nextTick(() => {
      try {
        if (data && data.editorContent) {
          loadDocumentJsonAtomically(editor, data.editorContent);
        } else {
          loadDocumentJsonAtomically(editor, initialContent);
          console.warn('[EditorService] 文件数据中缺少 editorContent，已重置为初始内容。');
        }
      
      // 手动发出内容加载完成事件
      if (editor.eventBus) {
        editor.eventBus.emit('file-content-loaded');
      }
      
      const realAnnotationStore = annotationStoreRef.value;
      if (realAnnotationStore && typeof realAnnotationStore.loadAnnotations === 'function') {
        realAnnotationStore.loadAnnotations(data.annotations || []);
        console.log('[EditorService] 批注已成功加载。');
      } else {
        console.warn('[EditorService] annotationStore.loadAnnotations 不可用，无法加载批注。');
      }

      fileStore.setFilePath(filePath, fileName);
      fileStore.setDirty(false);

      const plainText = editor.getText();
      const units = countTextUnitsZhEn(plainText);
      editorDocumentSettings.setCharacterCount(units);

    } catch (error) {
      console.error('[EditorService] 加载内容到编辑器时出错:', error);
      notificationStore.show(
        resolveCurrentEditorMessage('editor.service.loadFileFailed'),
        'error'
      );
    }
  });
}

/**
 * 如果文档内容包含 Workspace 工具写入的 rawMarkdownSource 占位块，
 * 则使用 WASM Markdown 解析器将其转换为完整块结构，并尽量回写到数据库。
 *
 * 该操作是「首开一次性迁移」：
 * - 解析成功后，数据库中的 content_json 将被更新为块结构 JSON
 * - 后续再次打开同一文档时，将直接使用块结构内容，不再重复解析 Markdown
 * @returns {Promise<{content: any, dirty: boolean}>} 返回规范化后的内容和是否需要保存的标志
 */
async function maybeNormalizeMarkdownContentWithWasm({ editor, rawContent, documentId }) {
  try {
    const rawMarkdown = extractRawMarkdownSource(rawContent);
    if (!rawMarkdown) {
      return { content: rawContent, dirty: false };
    }

    // 通过 markdownConversion 统一门面完成 Markdown → doc JSON 转换
    const schema = editor.state.schema;
    const { docJson } = await importMarkdownToDocJson({ markdown: rawMarkdown, schema });

    if (!docJson || !Array.isArray(docJson.content) || docJson.content.length === 0) {
      console.warn('[EditorService] Markdown 导入后未生成任何节点，保留原始占位内容。');
      return { content: rawContent, dirty: false };
    }

    // 以下为"首开迁移"专属逻辑：尝试回写 DB，后续打开直接使用块结构 JSON
    let saveSuccess = false;

    try {
      const result = await workspaceGateway['save-document']({
        documentId,
        content: docJson
      });
      if (!result || !result.success) {
        console.warn(
          '[EditorService] 回写解析后内容到数据库失败，将仅在本次会话中使用规范化内容:',
          result && result.error
        );
      } else {
        saveSuccess = true;
        console.log(
          '[EditorService] 已将解析后的 Markdown 文档写回 workspace 数据库，文档ID:',
          documentId
        );
      }
    } catch (e) {
      console.warn(
        '[EditorService] 回写解析后内容到数据库时出现异常，将仅在本次会话中使用规范化内容:',
        e
      );
    }

    // 回写成功 → dirty=false；回写失败（但内存已更新）→ dirty=true
    return { content: docJson, dirty: !saveSuccess };
  } catch (error) {
    console.error('[EditorService] 首开 Markdown 解析失败，保留原始内容:', error);
    return { content: rawContent, dirty: false };
  }
}

/**
 * 从文档 JSON 中提取 Workspace 工具写入的原始 Markdown 文本。
 * 约定：rawMarkdownSource 存储在 baseBlock.attrs.rawMarkdownSource 中。
 */
function extractRawMarkdownSource(docJson) {
  if (!docJson || !Array.isArray(docJson.content)) {
    return null;
  }

  for (let i = 0; i < docJson.content.length; i += 1) {
    const root = docJson.content[i];
    if (!root || !Array.isArray(root.content)) {
      continue;
    }
    for (let j = 0; j < root.content.length; j += 1) {
      const block = root.content[j];
      if (
        block &&
        block.type === 'baseBlock' &&
        block.attrs &&
        typeof block.attrs.rawMarkdownSource === 'string' &&
        block.attrs.rawMarkdownSource.trim().length > 0
      ) {
        return block.attrs.rawMarkdownSource;
      }
    }
  }

  return null;
}

/**
 * 设置并管理自动保存功能。
 * 该函数会主动监听 UI Store 中的编辑器实例，并在实例可用时启动自动保存逻辑。
 * @param {object} params
 * @param {object} params.stores - 包含所有必需 Pinia store 的对象。
 * @returns {Function} - 返回一个清理函数，用于停止所有与自动保存相关的监听和定时器。
 * setupAutoSave 已由 file-manager 接管，返回空清理函数。
 */
export function setupAutoSave() {
  console.warn('[EditorService] setupAutoSave 已由 file-manager 接管，此处仅返回空清理函数。');
  return () => {};
}
