/**
 * @file blockRefSnapshotSync.ts
 * @description 维护「documentId + ref -> blockId」的前端内存快照
 *
 * 背景：
 * - AI 会在回答中引用 [#ref]（短引用），用于定位某个 rootBlock
 * - ref 是由 blockId（稳定）确定性计算得到
 * - 因此只要前端能拿到“当前文档所有 rootBlock 的 blockId 列表”，就能建立 ref->blockId 映射
 *
 * 设计：
 * - 该模块只负责“从 editor 提取 rootBlockIds 并写入 blockIndexSnapshotStore”
 * - 不涉及 UI 渲染、不涉及 workspace 工具协议（低耦合）
 */

import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { useBlockIndexSnapshotStore } from '../../../../shared/stores/blockIndexSnapshotStore';

export interface SetupBlockRefSnapshotSyncOptions {
  editor: Editor;
  /**
   * 获取当前文档 ID。
   * - 推荐返回 fileStore.currentFilePath（当前文档 session 的文档 ID）
   * - fileStore.currentFilePath 也存的是 documentId，但建议只作备选来源
   */
  getDocumentId: () => string | null;
  /**
   * update 去抖时间，避免 editor 流式更新时频繁计算
   */
  debounceMs?: number;
}

function collectRootBlockIds(editor: Editor): string[] {
  const ids: string[] = [];

  editor.state.doc.descendants((node: ProseMirrorNode) => {
    if (node.type.name !== 'rootBlock') {
      return true;
    }

    const id = node.attrs && typeof node.attrs.id === 'string' ? node.attrs.id : '';
    if (id) {
      ids.push(id);
    }
    return true;
  });

  return ids;
}

/**
 * 安装快照同步：
 * - file-content-loaded：立即同步（文档刚加载/重载）
 * - editor update：去抖同步（用户编辑/AI 插入导致 block 变化）
 *
 * @returns cleanup，用于组件卸载时移除监听
 */
export function setupBlockRefSnapshotSync(options: SetupBlockRefSnapshotSyncOptions): () => void {
  const { editor, getDocumentId, debounceMs = 300 } = options;
  const snapshotStore = useBlockIndexSnapshotStore();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const syncOnce = async () => {
    const documentId = getDocumentId();
    if (typeof documentId !== 'string' || documentId.length === 0) {
      return;
    }

    const blockIds = collectRootBlockIds(editor);
    await snapshotStore.register(documentId, blockIds);
  };

  const scheduleSync = () => {
    if (destroyed) return;
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      syncOnce().catch((e) => {
        // 中文说明：快照同步失败不应打断用户编辑，仅记录错误以便排查
        console.warn('[blockRefSnapshotSync] 同步 ref 快照失败：', e);
      });
    }, debounceMs);
  };

  // 1) 文档加载完成：立即同步（不去抖）
  const onFileLoaded = () => {
    syncOnce().catch((e) => {
      console.warn('[blockRefSnapshotSync] file-content-loaded 同步 ref 快照失败：', e);
    });
  };

  // 2) 文档更新：去抖同步
  const onUpdate = () => {
    scheduleSync();
  };

  // TipTap editor 事件
  editor.on('update', onUpdate);

  // 我们的自定义事件总线：由 editorService 在 setContent 后 emit('file-content-loaded')
  if (editor.eventBus && typeof editor.eventBus.on === 'function') {
    editor.eventBus.on('file-content-loaded', onFileLoaded);
  }

  // 初次安装时也做一次同步（保证刚进入编辑器就能解析 ref）
  syncOnce().catch((e) => {
    console.warn('[blockRefSnapshotSync] init 同步 ref 快照失败：', e);
  });

  return () => {
    destroyed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    editor.off('update', onUpdate);
    if (editor.eventBus && typeof editor.eventBus.off === 'function') {
      editor.eventBus.off('file-content-loaded', onFileLoaded);
    }
  };
}
