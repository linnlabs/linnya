import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, EditorState, Transaction, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/**
 * 定义插件状态的接口
 */
interface TableVerticalNavState {
  lastGoodX: number | null;
}

/**
 * 创建并导出用于访问此插件状态的 PluginKey
 */
export const tableVerticalNavStateKey = new PluginKey<TableVerticalNavState>('tableVerticalNavState');

/**
 * 创建用于追踪光标垂直导航状态的 ProseMirror 插件
 *
 * @returns {Plugin<TableVerticalNavState>} ProseMirror 插件实例
 */
export const createTableVerticalNavStatePlugin = (): Plugin<TableVerticalNavState> => {
  // ✅ 使用闭包保存 EditorView，避免通过 this.spec.view 访问（需要 any 断言）
  let editorView: EditorView | undefined;

  return new Plugin<TableVerticalNavState>({
    key: tableVerticalNavStateKey,
    
    // 插件的状态管理
    state: {
      /**
       * 初始化插件状态
       */
      init(): TableVerticalNavState {
        return {
          lastGoodX: null,
        };
      },
      /**
       * 应用事务以更新状态
       * @param {Transaction} tr - 当前事务
       * @param {TableVerticalNavState} pluginState - 当前插件状态
       * @returns {TableVerticalNavState} 新的插件状态
       */
      apply(tr: Transaction, pluginState: TableVerticalNavState): TableVerticalNavState {
        // 检查事务元数据中是否有明确的设置 lastGoodX 的指令
        const meta = tr.getMeta(tableVerticalNavStateKey);
        if (meta) {
          if (typeof meta.set_lastGoodX === 'number') {
            // 如果指令是设置一个具体的数字，则更新
            return { lastGoodX: meta.set_lastGoodX };
          }
          if (meta.set_lastGoodX === null) {
            // 如果指令是重置，则清空
            return { lastGoodX: null };
          }
        }
        return pluginState;
      },
    },

    /**
     * 在主事务应用后追加一个新事务，用于自动更新 lastGoodX
     * @param {readonly Transaction[]} transactions - 在主 dispatch 中应用的所有事务
     * @param {EditorState} oldState - dispatch 前的旧状态
     * @param {EditorState} newState - dispatch 后的新状态
     * @returns {Transaction | null} 如果需要，返回一个用于更新 lastGoodX 的新事务
     */
    appendTransaction(
      transactions: readonly Transaction[],
      oldState: EditorState,
      newState: EditorState
    ): Transaction | null {
      // pending 注入期间跳过垂直导航状态更新
      if (transactions.some(tr => tr.getMeta('pendingRevisionApply'))) {
        return null
      }
      // 仅当选区实际发生变化时才继续
      if (!newState.selection.eq(oldState.selection)) {
        
        // 如果本次选区变化是由我们自己的垂直导航命令触发的，则不更新 X 坐标，以保持其稳定性
        if (transactions.some(tr => tr.getMeta('isVerticalNav'))) {
          return null;
        }

        // 如果选区不是光标（例如范围选择），则清空 lastGoodX，因为它不再有意义
        if (!(newState.selection instanceof TextSelection) || !newState.selection.empty) {
          const currentState = tableVerticalNavStateKey.getState(newState);
          if (currentState?.lastGoodX !== null) {
             return newState.tr.setMeta(tableVerticalNavStateKey, { set_lastGoodX: null });
          }
          return null;
        }
        
        // 轻量前置检查：光标不在表格 cell 内时，跳过 coordsAtPos DOM 测量
        const $head = newState.selection.$head;
        let inTableCell = false;
        for (let d = $head.depth; d > 0; d--) {
          const role = $head.node(d).type.spec.tableRole;
          if (role === 'cell' || role === 'header_cell') {
            inTableCell = true;
            break;
          }
        }

        if (!inTableCell) {
          const currentState = tableVerticalNavStateKey.getState(newState);
          if (currentState?.lastGoodX !== null) {
            return newState.tr.setMeta(tableVerticalNavStateKey, { set_lastGoodX: null });
          }
          return null;
        }

        // 光标在表格 cell 内，获取 view 实例做 DOM 测量
        if (!editorView || !editorView.dom.isConnected) {
          return null;
        }

        try {
          const coords = editorView.coordsAtPos(newState.selection.from);
          const currentState = tableVerticalNavStateKey.getState(newState);
          
          if (currentState && currentState.lastGoodX !== null && Math.abs(currentState.lastGoodX - coords.left) < 1) {
            return null;
          }
          return newState.tr.setMeta(tableVerticalNavStateKey, { set_lastGoodX: coords.left });
        } catch (e) {
          return null;
        }
      }
      return null;
    },

    /**
     * 将 view 实例附加到插件上，以便在 appendTransaction 中使用
     * @param {EditorView} view - 编辑器视图实例
     */
    view(view: EditorView) {
      editorView = view;
      return {
        destroy: () => {
          editorView = undefined;
        },
      };
    },
  });
};

/**
 * Tiptap registry 只能注册 Extension/Node/Mark，不能直接放 ProseMirror Plugin。
 * 这一窄包装让垂直导航状态进入正式生命周期，同时保留 plugin factory 供测试使用。
 */
export const TableVerticalNavigationStateExtension = Extension.create({
  name: 'tableVerticalNavigationState',

  addProseMirrorPlugins() {
    return [createTableVerticalNavStatePlugin()];
  },
});
