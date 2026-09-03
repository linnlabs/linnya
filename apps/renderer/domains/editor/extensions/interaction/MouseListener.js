// src/renderer/extensions/interaction/MouseListener.js
/**
 * MouseListener.js
 * 
 * 处理鼠标移动和拖拽事件
 * 当鼠标移动到 .root-block-outer 时显示文本输入光标
 * 在拖拽按钮上显示抓手光标
 */

export class MouseListener {
  /**
   * 初始化鼠标监听器
   * @param {Editor} editor - Tiptap 编辑器实例
   */
  constructor(editor) {
    this.editor = editor;
    this.rootBlockClass = '.root-block-outer';
    this.dragHandleClass = '.drag-handle';
    this.boundHandlers = {
      dragover: this.onDragOver.bind(this),
      drop: this.onDrop.bind(this),
      dragenter: this.onDragEnter.bind(this),
      dragleave: this.onDragLeave.bind(this)
    };
  }

  /**
   * 初始化鼠标事件监听
   */
  init() {
    document.addEventListener('mousemove', this.onMouseMove.bind(this));
    document.addEventListener('mousedown', this.onMouseDown.bind(this));
  }

  /**
   * 初始化拖拽相关事件
   * @param {HTMLElement} container - 编辑器容器元素
   */
  initDragEvents(container) {
    if (!container) return;
    
    // 添加所有拖拽相关事件监听器
    container.addEventListener('dragover', this.boundHandlers.dragover);
    container.addEventListener('drop', this.boundHandlers.drop);
    container.addEventListener('dragenter', this.boundHandlers.dragenter);
    container.addEventListener('dragleave', this.boundHandlers.dragleave);
  }

  /**
   * 处理鼠标移动事件
   * @param {MouseEvent} event - 鼠标事件
   */
  onMouseMove(event) {
    const target = event.target;
    
    if (target.closest(this.rootBlockClass)) {
      // 在 .root-block-outer 上显示文本输入光标
      document.body.style.cursor = 'text';
    } else if (target.closest(this.dragHandleClass)) {
      // 在拖拽按钮上显示抓手光标
      document.body.style.cursor = 'grab';
    } else {
      // 恢复默认光标
      document.body.style.cursor = '';
    }
  }

  /**
   * 处理鼠标按下事件
   * @param {MouseEvent} event - 鼠标事件
   */
  onMouseDown(event) {
    const target = event.target;
    
    if (target.closest(this.dragHandleClass)) {
      // 在拖拽按钮上按下时，显示抓取中的光标
      document.body.style.cursor = 'grabbing';
    }
  }

  /**
   * 处理拖拽进入事件
   * @param {DragEvent} event - 拖拽进入事件
   */
  onDragEnter(event) {
    console.log('[MouseListener] 处理拖拽进入事件');
  }

  /**
   * 处理拖拽经过事件
   * @param {DragEvent} event - 拖拽事件
   */
  onDragOver(event) {
    // 阻止默认行为以允许放置
    event.preventDefault();
    
    // 设置放置效果
    event.dataTransfer.dropEffect = 'move';
    
    // 获取当前拖拽经过的元素
    const target = event.target;
    const currentBlock = target.closest('.root-block-outer');
    
    // 如果不是 rootBlock，不显示放置指示器
    if (!currentBlock || currentBlock.getAttribute('data-node-type') !== 'rootBlockOuter') {
      event.dataTransfer.dropEffect = 'none';
      return;
    }
  }

  /**
   * 处理拖拽离开事件
   * @param {DragEvent} event - 拖拽离开事件
   */
  onDragLeave(event) {
    // 不需要特殊处理
  }

  /**
   * 处理放置事件
   * @param {DragEvent} event - 放置事件
   */
  onDrop(event) {
    event.preventDefault();
  }

  /**
   * 销毁所有事件监听
   */
  destroy() {
    document.removeEventListener('mousemove', this.onMouseMove.bind(this));
    document.removeEventListener('mousedown', this.onMouseDown.bind(this));
    
    // 如果有绑定拖拽事件的容器，清理这些事件
    const container = document.querySelector('.editor-content');
    if (container) {
      container.removeEventListener('dragover', this.boundHandlers.dragover);
      container.removeEventListener('drop', this.boundHandlers.drop);
      container.removeEventListener('dragenter', this.boundHandlers.dragenter);
      container.removeEventListener('dragleave', this.boundHandlers.dragleave);
    }
  }
}

// 导出类
export default MouseListener;