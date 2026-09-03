import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { emitBlockOperation, BlockAction } from '../../shared/utils/blockEventUtils';
import { EDITOR_EPHEMERAL_TRANSACTION_META } from '../../core/transactions/editorTransactionMeta';

// 专用 PluginKey，方便在 view.update 中安全获取插件 state
const blockLifecyclePluginKey = new PluginKey('blockLifecycle');
const SUPPRESSED_DELETE_WARN_THROTTLE_MS = 10_000;
let lastSuppressedDeleteWarnAt = 0;

function isEditorEphemeralTransaction(tr) {
  return Boolean(tr.getMeta(EDITOR_EPHEMERAL_TRANSACTION_META));
}

function collectRootBlockIds(doc) {
  const ids = new Set();
  doc.descendants((node) => {
    if (node.type.name === 'rootBlock') {
      ids.add(node.attrs.id);
      return false;
    }
  });
  return ids;
}

function collectDeletedRootBlockIds(previousIds, nextIds) {
  const deleted = [];
  for (const id of previousIds) {
    if (!nextIds.has(id)) {
      deleted.push(id);
    }
  }
  return deleted;
}

function warnSuppressedEphemeralDeletes(deleted) {
  if (deleted.length === 0) return;

  const now = Date.now();
  if (now - lastSuppressedDeleteWarnAt < SUPPRESSED_DELETE_WARN_THROTTLE_MS) return;
  lastSuppressedDeleteWarnAt = now;

  console.warn('[BlockLifecycleExtension] 内部渲染事务出现 rootBlock 删除，已阻止 block-operation 副作用', {
    deletedCount: deleted.length,
    sampleBlockIds: deleted.slice(0, 8),
  });
}

export const BlockLifecycleExtension = Extension.create({
  name: 'blockLifecycle',

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: blockLifecyclePluginKey,
        state: {
          init(config, instance) {
            return { ids: collectRootBlockIds(instance.doc), deleted: [] };
          },
          apply(tr, value, oldState, newState) {
            if (!tr.docChanged) {
              // 中文说明：deleted 是“本次事务”的瞬时结果，不能跨 selection/update 事务复用。
              // 否则一次删除可能在后续非文档事务里被 view.update 重复广播。
              return value.deleted.length === 0 ? value : { ids: value.ids, deleted: [] };
            }

            const newIds = collectRootBlockIds(newState.doc);
            const deleted = collectDeletedRootBlockIds(value.ids, newIds);

            if (isEditorEphemeralTransaction(tr)) {
              // 中文说明：pending 投影、虚拟化 hydrate/dehydrate、citation 派生都是渲染层事务。
              // 它们可能替换局部内容或改变 mark，但不代表用户删除块；
              // 这里必须只刷新 ID 快照，不能触发 Revision/Annotation 的删除副作用。
              warnSuppressedEphemeralDeletes(deleted);
              return { ids: newIds, deleted: [] };
            }

            return { ids: newIds, deleted };
          }
        },
        view() {
          return {
            // 视图更新时，根据插件 state 中的 deleted 列表发出 block-operation 事件
            update(view) {
              const pluginState = blockLifecyclePluginKey.getState(view.state);
              if (!pluginState || !pluginState.deleted || pluginState.deleted.length === 0) {
                return;
              }

              // 这里不直接操作批注数据，而是复用既有的 block-operation 通道
              emitBlockOperation(editor, BlockAction.DELETE, pluginState.deleted, {
                source: 'blockLifecyclePlugin',
              });
            },
          };
        },
      })
    ];
  }
});
