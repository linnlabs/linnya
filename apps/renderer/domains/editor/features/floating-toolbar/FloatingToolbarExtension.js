
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { floatingToolbarService } from './service';
import { TextSelection, AllSelection, Selection } from 'prosemirror-state';
import { CellSelection } from '@tiptap/pm/tables';

// 计算悬浮工具栏位置的基础逻辑
// 文本选区：尽量与选区起始位置左对齐；若右侧空间不足，则向左收缩，避免溢出视口。
// 表格选区：与单元格左侧对齐。
const calculatePosition = (view) => {
    const { selection } = view.state;
    
    if (selection.empty) return null;

    if (selection instanceof TextSelection || selection instanceof AllSelection) {
        // 注意：Cmd+A 触发的 AllSelection 的 from 往往是 0（文档边界位置）。
        // coordsAtPos(0) 取到的是“容器边界”的坐标，视觉上会比第一个字符更靠左，从而导致工具栏左偏。
        // 这里使用 Selection.atStart(doc) 找到文档中“真正可落点”的起始位置，保证与手动从开头拖选一致。
        const anchorPos =
          selection instanceof AllSelection ? Selection.atStart(view.state.doc).from : selection.from;
        const start = view.coordsAtPos(anchorPos);
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const APPROX_TOOLBAR_WIDTH = 260; // 经验值：工具栏大致宽度，用于避免超出右侧视口
        const MARGIN = 8; // 与视口边缘预留的安全间距

        // 优先与选区开头左对齐
        let left = start.left;

        // 如果右侧空间不够，则向左收缩
        if (left + APPROX_TOOLBAR_WIDTH > viewportWidth - MARGIN) {
          left = Math.max(MARGIN, viewportWidth - MARGIN - APPROX_TOOLBAR_WIDTH);
        }

        return {
          top: start.top - 40,
          left: left,
        };
    }
    
    if (selection instanceof CellSelection) {
        // You would import and use your more complex calculateToolbarPosition for tables here
        const cell = view.domAtPos(selection.from).node.closest('td, th');
        if (cell) {
            const rect = cell.getBoundingClientRect();
            return {
                top: rect.top - 40,
                left: rect.left,
            };
        }
    }

    return null;
};


class FloatingToolbarView {
  constructor(editorView, tiptapEditor) {
    this.editorView = editorView;
    this.editor = tiptapEditor;

    this.isMouseDown = false;
    this.mouseDownInsideEditor = false;
    this.selectionKeyOnMouseDown = null;

    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleDocumentMouseDown = this.handleDocumentMouseDown.bind(this);

    // 监听鼠标按下/抬起，避免在拖动选择过程中就显示工具栏
    this.editorView.dom.addEventListener('mousedown', this.handleMouseDown, true);
    window.addEventListener('mouseup', this.handleMouseUp, true);
    // 监听整个文档的点击，用于点击其它区域时关闭工具栏
    document.addEventListener('mousedown', this.handleDocumentMouseDown, true);

    this.update(editorView, null);
  }

  update(editorView, prevState) {
    // 拖拽选择过程中不显示工具栏，只在鼠标松开并确认选区后再决定是否展示
    if (this.isMouseDown && this.mouseDownInsideEditor) {
      floatingToolbarService.close();
      return;
    }

    if (!this.editor || !this.editor.isEditable) {
      floatingToolbarService.close();
      return;
    }

    const context = { editor: this.editor };
    floatingToolbarService.update(context);

    if (floatingToolbarService.state.isOpen) {
        const position = calculatePosition(editorView);
        if (position) {
            floatingToolbarService.setPosition(position);
        } else {
            floatingToolbarService.close();
        }
    }
  }

  handleMouseDown(event) {
    this.isMouseDown = true;

    const editorDOM = this.editorView?.dom;
    // 只在编辑器内部的按下，才视为“可能启动一次新的选区交互”
    this.mouseDownInsideEditor = !!(editorDOM && editorDOM.contains(event.target));

    if (!this.mouseDownInsideEditor) {
      // 如果按下发生在编辑器之外（例如 AppHeader、侧边栏），
      // 不记录选区快照，也不干预后续 mouseup（让 click-outside 逻辑单独处理）
      return;
    }

    // 记录按下时的选区，用于判断鼠标抬起后是否真的发生了“新选择”
    if (this.editorView) {
      this.selectionKeyOnMouseDown = this.getSelectionKey(this.editorView.state.selection);
    }
    // 拖动开始时立刻隐藏工具栏，避免干扰选区
    floatingToolbarService.close();
  }

  handleMouseUp(event) {
    // 鼠标抬起后再重新评估是否需要显示工具栏
    this.isMouseDown = false;

    // 如果这次按下并不是从编辑器内部开始的（例如点击 AppHeader 或侧边栏），
    // 那么不要在 mouseup 时做任何“按选区重新打开工具栏”的逻辑。
    if (!this.mouseDownInsideEditor) {
      this.selectionKeyOnMouseDown = null;
      return;
    }

    this.mouseDownInsideEditor = false;
    // 使用 setTimeout 让 ProseMirror 先完成选区事务，再读取最新 selection
    setTimeout(() => {
      if (!this.editorView) return;

      const newKey = this.getSelectionKey(this.editorView.state.selection);

      // 1) 新选区为空：直接关闭工具栏
      if (!newKey) {
        floatingToolbarService.close();
      }
      // 2) 选区未变化：视为“取消当前选区的有效性”，关闭工具栏
      else if (newKey === this.selectionKeyOnMouseDown) {
        floatingToolbarService.close();
      }
      // 3) 选区发生变化且非空：这是一次新的选择，允许根据 Provider 重新决定是否展示工具栏
      else {
        this.update(this.editorView, null);
      }

      this.selectionKeyOnMouseDown = null;
    }, 0);
  }

  // 将 ProseMirror 选区转换为一个可比较的 key，用于判断是否“发生了新的选择”
  getSelectionKey(selection) {
    if (!selection || selection.empty) return null;

    if (selection instanceof TextSelection || selection instanceof AllSelection) {
      return `text:${selection.from}-${selection.to}`;
    }

    if (selection instanceof CellSelection) {
      const anchorPos = selection.$anchorCell?.pos ?? selection.from;
      const headPos = selection.$headCell?.pos ?? selection.to;
      return `cell:${anchorPos}-${headPos}`;
    }

    return null;
  }

  // 在编辑器之外点击时关闭工具栏（但点击工具栏本身不会关闭）
  handleDocumentMouseDown(event) {
    const target = event.target;
    const editorDOM = this.editorView?.dom;

    // 若点击发生在浮动工具栏内部，则忽略（允许点击按钮）
    if (target && typeof target.closest === 'function') {
      const toolbarEl = target.closest('.floating-toolbar');
      if (toolbarEl) {
        return;
      }
    }

    // 若点击在编辑器 DOM 内部，由 ProseMirror 的 selection 更新逻辑决定是否显示/隐藏
    if (editorDOM && editorDOM.contains(target)) {
      return;
    }

    // 其它任意区域点击时，直接关闭工具栏
    floatingToolbarService.close();
  }

  destroy() {
    // 清理事件监听
    if (this.editorView && this.editorView.dom) {
      this.editorView.dom.removeEventListener('mousedown', this.handleMouseDown, true);
    }
    window.removeEventListener('mouseup', this.handleMouseUp, true);
    document.removeEventListener('mousedown', this.handleDocumentMouseDown, true);
  }
}

export const FloatingToolbarExtension = Extension.create({
  name: 'floatingToolbar',

  addProseMirrorPlugins() {
    const tiptapEditor = this.editor;

    if (!tiptapEditor) {
      return [];
    }

    return [
      new Plugin({
        key: new PluginKey('floatingToolbarPlugin'),
        view: (editorView) => {
          return new FloatingToolbarView(editorView, tiptapEditor);
        },
      }),
    ];
  },
});
