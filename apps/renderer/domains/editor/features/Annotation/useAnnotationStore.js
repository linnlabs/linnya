// src/renderer/extensions/annotation/useAnnotationStore.js
/**
 * useAnnotationStore.js
 * 
 * 使用Vue 3的组合式API创建批注数据存储的可复用逻辑
 * 
 * 职责：
 * 1. 在内存中维护响应式批注数据
 * 2. 提供批注数据的CRUD操作API
 * 3. 提供批注数据的查询功能
 * 4. 管理批注状态
 */

import { ref, reactive, computed, watch, nextTick } from 'vue';
import { generateannotationId, generatePrefixedId } from '../../../../shared/utils/idUtils';
import { useFileStore } from '../../../../shared/stores/file';
import { workspaceGateway } from '../../../../shared/ipc/workspaceGateway'; // +++
import { resolveAnnotationRootBlockId } from './functions/rootBlockIdResolver';

/**
 * 自定义错误类
 */
export class AnnotationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AnnotationError';
    this.code = code;
  }
}

/**
 * 批注状态类型
 * @typedef {'creating'|'editing'|'confirmed'|'resolved'} AnnotationState
 */

/**
 * 批注对象类型
 * @typedef {{
 *   id: string,              // 批注自身唯一 ID（UUID 或时间戳）
 *   blockId: string,         // 所属 Block 的 ID (对应 DOM 中 .root-block-outer 元素的 data-id)
 *   content: string,         // 批注文字内容
 *   state: AnnotationState,  // 当前批注状态
 *   replies?: AnnotationReply[], // （可选）回复列表：预留给未来 AI/协作回复能力
 *   position: {              // 批注位置
 *     top: number,          // 顶部位置
 *     left: number          // 左侧位置
 *   },
 *   createdAt: string,       // 创建时间（ISO 时间格式）
 *   author?: string          // （可选）批注创建者名
 * }} Annotation
 */

/**
 * 批注回复对象类型（预留给未来能力：AI 回复/多人协作回复）
 * @typedef {{
 *   id: string,          // 回复唯一 ID
 *   content: string,     // 回复内容
 *   author: string,      // 回复作者（例如：用户/AI/协作者昵称）
 *   createdAt: string    // 回复创建时间（ISO 时间格式）
 * }} AnnotationReply
 */

/**
 * 创建批注对象的工厂函数
 * @param {Object} params - 批注参数
 * @param {string} params.blockId - 块ID (对应 DOM 中 .root-block-outer 元素的 data-id)
 * @param {string} params.content - 批注内容
 * @param {string} [params.id] - 可选的自定义ID
 * @param {Object} [params.position] - 可选的位置
 * @param {string} [params.author] - 可选的作者
 * @param {AnnotationState} [params.state] - 可选的状态
 * @returns {Annotation} 批注对象
 */
export function createAnnotation({ blockId, content, id, position, author, state }) {
  try {
    if (!blockId) {
      throw new AnnotationError('创建批注失败：缺少 blockId', 'MISSING_BLOCK_ID');
    }
    if (content === undefined || content === null) {
      throw new AnnotationError('创建批注失败：缺少 content 参数', 'MISSING_CONTENT');
    }

    return {
      id: id || generateannotationId(),
      blockId,
      content,
      position: position || { top: 0, left: 0 },
      author: author || 'User',
      state: state || 'confirmed',
      // 预留字段：回复列表（当前不在 UI 中正式开放，仅提供 API 入口）
      replies: [],
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    console.error(`[useAnnotationStore] ${error.message}`, error);
    throw error;
  }
}

/**
 * 批注存储的组合式API
 * @param {Object} options - 配置选项
 * @param {Object} options.editor - 编辑器实例
 * @returns {Object} 批注存储API
 */
export function useAnnotationStore(options = {}) {
  const { editor } = options;
  
  const fileStore = useFileStore();

  // 批注数据
  const annotations = ref([]);
  const annotationsIndexByBlockId = reactive(new Map());
  const EMPTY_ANNOTATIONS = Object.freeze([]);

  const rebuildAnnotationsIndex = (list) => {
    annotationsIndexByBlockId.clear();
    list.forEach((anno) => {
      const blockId = anno?.blockId;
      if (typeof blockId !== 'string' || blockId.length === 0) return;
      const bucket = annotationsIndexByBlockId.get(blockId);
      if (bucket) {
        bucket.push(anno);
      } else {
        annotationsIndexByBlockId.set(blockId, [anno]);
      }
    });
  };

  const addAnnotationToIndex = (annotation) => {
    const blockId = annotation?.blockId;
    if (typeof blockId !== 'string' || blockId.length === 0) return;
    const bucket = annotationsIndexByBlockId.get(blockId);
    if (bucket) {
      bucket.push(annotation);
    } else {
      annotationsIndexByBlockId.set(blockId, [annotation]);
    }
  };

  const normalizeAnnotationBlockId = (blockId) => {
    return resolveAnnotationRootBlockId(editor, blockId) || blockId;
  };

  const removeAnnotationFromIndex = (annotation) => {
    const blockId = annotation?.blockId;
    if (typeof blockId !== 'string' || blockId.length === 0) return;
    const bucket = annotationsIndexByBlockId.get(blockId);
    if (!bucket || bucket.length === 0) return;
    const nextBucket = bucket.filter((item) => item.id !== annotation.id);
    if (nextBucket.length > 0) {
      annotationsIndexByBlockId.set(blockId, nextBucket);
    } else {
      annotationsIndexByBlockId.delete(blockId);
    }
  };
  
  // 内部状态
  const state = reactive({
    batchOperationInProgress: false,
    isSyncing: false, // +++
  });
  
  // 按blockId分组的批注
  const annotationsByBlockId = computed(() => {
    const grouped = {};
    annotationsIndexByBlockId.forEach((bucket, blockId) => {
      grouped[blockId] = bucket;
    });
    return grouped;
  });
  
  // 按状态分组的批注
  const annotationsByState = computed(() => {
    const grouped = {
      creating: [],
      editing: [],
      confirmed: [],
      resolved: []
    };
    annotations.value.forEach(anno => {
      if (grouped[anno.state]) {
        grouped[anno.state].push(anno);
      }
    });
    return grouped;
  });
  
  /**
   * 加载批注数据（替换现有数据）
   * @param {Annotation[]} annotationsArray - 从文件或其他来源加载的批注数组
   */
  const loadAnnotations = (annotationsArray) => {
    if (!Array.isArray(annotationsArray)) {
      console.error('[useAnnotationStore] 加载批注失败: 提供的数据不是数组');
      return;
    }

    /**
     * ✅ 位置归一化（根因修复：后端落库的批注不一定包含 position）
     *
     * 背景：
     * - 批注面板布局系统（PanelOverlapDetector 等）默认依赖 annotation.position.top/left 为 number
     * - 从 DB 拉回来的 annotations 可能缺少 position（历史数据或某些写入路径）
     * - 如果直接渲染，会出现“面板堆在一起，然后缓慢移动/跳动”的体验，甚至在某些路径下报错
     *
     * 原则：
     * - position 属于“视图模型字段”：应由前端根据当前 DOM/滚动容器计算出理想位置
     * - 因此在 loadAnnotations 阶段就把缺失的 position 补齐为理想位置，保证首次渲染即正确
     */
    const calc = editor?.panelPositionManager?.calculateInitialPositionCSS;
    const canCalcPosition = typeof calc === 'function';

    const normalized = annotationsArray.map((anno) => {
      // 保持对象结构稳定，避免直接修改入参
      const next = { ...anno };
      if (typeof next.blockId === 'string' && next.blockId.length > 0) {
        next.blockId = normalizeAnnotationBlockId(next.blockId);
      }

      const pos = next.position;
      const hasValidPosition =
        pos &&
        typeof pos.top === 'number' &&
        typeof pos.left === 'number' &&
        !Number.isNaN(pos.top) &&
        !Number.isNaN(pos.left);

      // 视为无效位置：无效格式 或 原点(0,0)（后端默认值）
      if (hasValidPosition && !(pos.top === 0 && pos.left === 0)) {
        return next;
      }

      // 优先使用布局系统同步计算理想位置（避免先堆叠再挪动）
      if (canCalcPosition && typeof next.blockId === 'string' && next.blockId.length > 0) {
        const css = calc(next.blockId);
        if (css && typeof css.top === 'string' && typeof css.left === 'string') {
          const top = parseFloat(css.top);
          const left = parseFloat(css.left);
          if (!Number.isNaN(top) && !Number.isNaN(left)) {
            next.position = { top, left };
            return next;
          }
        }
      }

      // 最后回退：给一个稳定的默认值，后续布局系统会重算
      next.position = { top: 0, left: 0 };
      return next;
    });

    // 直接替换 ref 的值
    annotations.value = normalized;
    rebuildAnnotationsIndex(normalized);
    
    // ✅ 触发一次重叠检测（确保批量加载的批注在首次渲染后即解决重叠）
    if (editor?.panelPositionManager?.handleOverlapsOnly) {
      nextTick(() => {
        editor.panelPositionManager.handleOverlapsOnly();
      });
    }

    // 加载后，通常文件状态应为未修改
    // fileStore.setDirty(false); // 这应该在加载逻辑的更高层处理
  };

  /**
   * 获取当前所有批注的数组副本
   * @returns {Annotation[]}
   */
  const getCurrentAnnotations = () => {
    // 返回一个浅拷贝，防止外部直接修改内部 ref
    return [...annotations.value];
  };
  
  /**
   * 添加批注到存储
   * @param {Partial<Annotation>} annotationData - 批注数据 (至少包含 blockId 和 content)
   * @returns {string|null} - 新批注ID或null
   */
  const addAnnotation = async (annotationData) => { // +++
    try {
      if (!fileStore.currentFilePath) { // +++
        console.error('[useAnnotationStore] 无法添加批注：没有活动的文档ID。');
        return null;
      }
      if (annotationData.blockId === undefined || annotationData.content === undefined) {
         console.error('[useAnnotationStore] 添加批注失败: annotationData 必须包含 blockId 和 content');
         return null;
      }

      const normalizedBlockId = normalizeAnnotationBlockId(annotationData.blockId);
      const newAnnotation = createAnnotation({
        ...annotationData,
        blockId: normalizedBlockId,
      });

      if (annotations.value.some(a => a.id === newAnnotation.id)) {
        console.warn(`[useAnnotationStore] 批注已存在，跳过添加: ${newAnnotation.id}`);
        return newAnnotation; // 返回已存在的批注
      }

      annotations.value.push(newAnnotation);
      addAnnotationToIndex(newAnnotation);
      
      // 中文说明：批注创建必须先进入本地 creating 态，不能被 IPC 往返拖住。
      // 持久化失败目前只记录错误，保持与旧逻辑“不回滚本地批注”的语义一致。
      state.isSyncing = true;
      void (async () => {
        try {
          const payload = {
            ...newAnnotation,
            documentId: fileStore.currentFilePath
          };
          const result = await workspaceGateway['create-annotation'](payload);
          if (!result.success) {
            console.error('[useAnnotationStore] 持久化新批注失败:', result.error);
            // TODO: Add error handling, maybe revert the local change
          } else {
            // 可选：用后端返回的 ID 更新前端 ID，确保一致性
            // newAnnotation.id = result.data.annotationId;
          }
        } catch (e) {
          console.error('[useAnnotationStore] 调用 create-annotation IPC 时出错:', e);
        } finally {
          state.isSyncing = false;
        }
      })();

      return newAnnotation;

    } catch {
      // createAnnotation 内部已打印错误
      return null;
    }
  };
  
  /**
   * 从存储中删除批注
   * @param {string} annotationId - 批注ID
   * @returns {boolean} - 是否成功删除
   */
  const removeAnnotation = async (annotationId) => { // +++
    if (!annotationId) {
      console.error(`[useAnnotationStore] 删除批注失败: 缺少批注ID`);
      return false;
    }
    const index = annotations.value.findIndex(a => a.id === annotationId);
    if (index === -1) {
      console.warn(`[useAnnotationStore] 删除批注失败: 批注 ${annotationId} 不存在`);
      return false;
    }
    const removedAnnotation = annotations.value[index];
    annotations.value.splice(index, 1);
    removeAnnotationFromIndex(removedAnnotation);
    
    // +++ 异步持久化 +++
    state.isSyncing = true;
    try {
      const result = await workspaceGateway['delete-annotation']({ annotationId });
      if (!result.success) {
        console.error(`[useAnnotationStore] 持久化删除批注 ${annotationId} 失败:`, result.error);
        // TODO: Add error handling
      }
    } catch (e) {
      console.error(`[useAnnotationStore] 调用 delete-annotation IPC 时出错:`, e);
    } finally {
      state.isSyncing = false;
    }

    return true;
  };
  
  /**
   * 更新存储中的批注
   * @param {string} annotationId - 批注ID
   * @param {Partial<Omit<Annotation, 'id' | 'blockId' | 'createdAt'>>} updates - 要更新的字段 (不允许更新 id, blockId, createdAt)
   * @returns {boolean} - 是否成功更新
   */
  const updateAnnotation = async (annotationId, updates) => { // +++
    if (!annotationId) {
      console.error(`[useAnnotationStore] 更新批注失败: 缺少批注ID`);
      return false;
    }
    const annotation = annotations.value.find(a => a.id === annotationId);
    if (!annotation) {
      console.warn(`[useAnnotationStore] 更新批注失败: 批注 ${annotationId} 不存在`);
      return false;
    }

    // 显式排除不允许更新的字段
    const allowedUpdates = { ...updates };
    delete allowedUpdates.id;
    delete allowedUpdates.blockId;
    delete allowedUpdates.createdAt;
    if (Object.keys(allowedUpdates).length === 0) {
        console.warn(`[useAnnotationStore] 更新批注 ${annotationId}: 没有提供有效更新字段`);
        return false;
    }

    // **这里允许更新 position，因为 position 不在排除列表里**
    Object.assign(annotation, allowedUpdates);

    // +++ 异步持久化 +++
    state.isSyncing = true;
    try {
      const result = await workspaceGateway['update-annotation']({ annotationId, updates: allowedUpdates });
      if (!result.success) {
        console.error(`[useAnnotationStore] 持久化更新批注 ${annotationId} 失败:`, result.error);
        // TODO: Add error handling
      }
    } catch (e) {
      console.error(`[useAnnotationStore] 调用 update-annotation IPC 时出错:`, e);
    } finally {
      state.isSyncing = false;
    }

    return true;
  };

  /**
   * 追加一条回复到指定批注（最小实现：仅更新 annotation.content_json 中的 replies 字段）
   *
   * 说明：
   * - 这是“回复能力”的 API 入口，不意味着 UI 已经正式开放回复功能；
   * - 持久化复用现有 `update-annotation`，后端会 merge 到 content_json，无需新增后端接口。
   *
   * @param {string} annotationId - 批注ID
   * @param {{ content: string, author?: string, createdAt?: string, id?: string }} replyInput - 回复输入
   * @returns {Promise<AnnotationReply|null>} - 返回创建的回复对象，失败返回 null
   */
  const addReply = async (annotationId, replyInput) => {
    if (!annotationId) {
      console.error('[useAnnotationStore] 添加回复失败: 缺少 annotationId');
      return null;
    }
    const annotation = getAnnotationById(annotationId);
    if (!annotation) {
      console.warn(`[useAnnotationStore] 添加回复失败: 批注 ${annotationId} 不存在`);
      return null;
    }
    const rawContent = replyInput?.content;
    if (typeof rawContent !== 'string' || !rawContent.trim()) {
      console.warn('[useAnnotationStore] 添加回复失败: replyInput.content 为空');
      return null;
    }

    /** @type {AnnotationReply} */
    const newReply = {
      id: replyInput?.id || generatePrefixedId('anno-reply'),
      content: rawContent,
      author: replyInput?.author || 'User',
      createdAt: replyInput?.createdAt || new Date().toISOString(),
    };

    // 确保 replies 为数组
    const existingReplies = Array.isArray(annotation.replies) ? annotation.replies : [];
    const nextReplies = [...existingReplies, newReply];

    const ok = await updateAnnotation(annotationId, { replies: nextReplies });
    return ok ? newReply : null;
  };

  /**
   * 获取某个批注的回复列表
   * @param {string} annotationId
   * @returns {AnnotationReply[]}
   */
  const getRepliesByAnnotationId = (annotationId) => {
    const annotation = getAnnotationById(annotationId);
    if (!annotation) return [];
    return Array.isArray(annotation.replies) ? [...annotation.replies] : [];
  };
  
  /**
   * 处理批注更新事件 - 保持为内部方法
   */
  const handleAnnotationUpdate = (event) => {
    const meta = event.detail;
    if (!meta) return;

    switch (meta.type) {
      case 'add':
        addAnnotation({
          id: meta.id,
          blockId: meta.blockId,
          content: meta.content,
          state: meta.state,
          position: meta.position,
          author: meta.author
        });
        break;
      case 'remove':
        removeAnnotation(meta.id);
        break;
      case 'update':
        updateAnnotation(meta.id, {
          content: meta.content,
          state: meta.state,
        });
        break;
      case 'updateState':
        updateAnnotation(meta.id, { state: meta.state });
        break;
    }
  };
  
  /**
   * 按块ID获取批注
   * @param {string} blockId - 块ID
   * @returns {Annotation[]} 批注数组
   */
  function getAnnotationsByBlockId(blockId) {
    if (!blockId) {
      console.warn('[useAnnotationStore] 获取批注失败: 块ID为空');
      return [];
    }
    
    return annotationsIndexByBlockId.get(blockId) || EMPTY_ANNOTATIONS;
  }
  
  /**
   * 获取所有批注
   * @returns {Annotation[]} 批注数组
   */
  function getAllAnnotations() {
    return [...annotations.value];
  }
  
  /**
   * 获取特定ID的批注
   * @param {string} annotationId - 批注ID
   * @returns {Annotation|null} 批注对象或null
   */
  function getAnnotationById(annotationId) {
    return annotations.value.find(a => a.id === annotationId) || null;
  }
  
  /**
   * 开始批量操作
   */
  function startBatchOperation() {
    state.batchOperationInProgress = true;
  }
  
  /**
   * 结束批量操作
   */
  function endBatchOperation() {
    state.batchOperationInProgress = false;
    
    // 触发批量更新完成事件
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new window.CustomEvent('annotations-batch-updated', {
        detail: { 
          annotations: [...annotations.value]
        }
      }));
    }
  }
  
  /**
   * 初始化：添加事件监听器
   * 这个方法应该在 store 实例创建后被外部调用
   */
  const initialize = () => {
    if (typeof window !== 'undefined') {
      window.addEventListener('annotation-update', handleAnnotationUpdate);
    }
    // +++ 监听文档变化以重新加载批注 +++
    watch(() => fileStore.currentFilePath, async (newDocumentId, oldDocumentId) => {
      if (newDocumentId && newDocumentId !== oldDocumentId) {
        // This is now handled by the document loading process in Sidebar.vue
        // which calls loadAnnotations directly.
        // Keeping this watch for potential future needs but it's currently redundant.
        console.log(`[useAnnotationStore] Document changed to ${newDocumentId}. Annotations are loaded by the openDocument process.`);
      } else if (!newDocumentId) {
        // 文档关闭，清空批注
        annotations.value = [];
        annotationsIndexByBlockId.clear();
      }
    }, { immediate: true });
  };
  
  /**
   * 清理：移除事件监听器
   * 这个方法应该在 EditorContext 卸载前被外部调用
   */
  const cleanup = () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('annotation-update', handleAnnotationUpdate);
    }
  };
  
  // 监听批注数组变化，发布状态变更事件 (这个 watch 依赖 annotations ref，可以保留在 composable 内部)
  watch(annotations, (newVal, oldVal) => {
    if (!state.batchOperationInProgress && typeof window !== 'undefined') { // 添加检查，避免批量操作时触发
      window.dispatchEvent(new window.CustomEvent('annotations-changed', {
        detail: {
          annotations: [...newVal],
          prev: oldVal ? [...oldVal] : []
        }
      }));
    }
  }, { deep: true });
  
  // 返回公共API，包含 cleanup 方法
  return {
    editor,
    annotations,
    annotationsByBlockId,
    annotationsByState,
    addAnnotation,
    removeAnnotation,
    updateAnnotation,
    // 回复能力（预留 API）
    addReply,
    getRepliesByAnnotationId,
    getAnnotationsByBlockId,
    getAllAnnotations,
    getAnnotationById,
    startBatchOperation,
    endBatchOperation,
    createAnnotation,
    initialize, // 暴露 initialize 方法
    cleanup,    // 暴露 cleanup 方法
    // +++ 新增方法 +++
    loadAnnotations,        // 暴露加载方法
    getCurrentAnnotations,  // 暴露获取方法
  };
}

// 将工厂函数导出为默认导出
export default useAnnotationStore;
