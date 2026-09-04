// src/renderer/extensions/annotation/position/PanelFinder.js
/**
 * PanelFinder.js
 * 
 * 批注面板查找模块
 * 专注于查找DOM中的批注面板元素和相关元素
 */

export function createPanelFinder(editor) {
  const escapeCssAttributeValue = (value) => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  };

  /**
   * 读取当前 Annotation 实例所属的 ProseMirror DOM。
   *
   * 中文说明：WorkspaceStage 外层和 Markdown Document Surface 内层都可能存在
   * `.editor-shell/.scroll-content-wrapper`。所有查询必须从当前 editor owner 向外或
   * 向内解析，禁止回退到 document 全局查询，否则右侧 pane 会把外层横向偏移重复计算。
   */
  const findEditorRoot = () => {
    const editorRoot = editor?.view?.dom;
    return editorRoot instanceof HTMLElement ? editorRoot : null;
  };

  /**
   * 查找块元素
   * @param {string} blockId - 块ID
   * @returns {Element|null} - 块元素或null
   */
  const findBlockElement = (blockId) => {
    if (!blockId) {
      console.error('[PanelFinder] findBlockElement: blockId为空');
      return null;
    }
    
    const editorRoot = findEditorRoot();
    if (!editorRoot) return null;

    const escapedBlockId = escapeCssAttributeValue(blockId);
    const blockElement = editorRoot.querySelector(`.root-block-outer[data-id="${escapedBlockId}"]`);
    if (blockElement) {
      return blockElement;
    }

    // 中文说明：兼容历史批注误存了内容块 ID 的情况。
    // 如果内容 DOM 当前仍在视口内，可以向上归一到 rootBlock；离屏 placeholder
    // 没有内容 DOM 时应由 loadAnnotations / 创建入口先做 doc 级归一化。
    const elementWithId = editorRoot.querySelector(`[data-id="${escapedBlockId}"]`);
    const rootBlockFromChild = elementWithId?.closest?.('.root-block-outer[data-id]');
    if (rootBlockFromChild) {
      return rootBlockFromChild;
    }

    console.warn(`[PanelFinder] findBlockElement: 未找到 .root-block-outer[data-id="${blockId}"]`);
    return null;
  };

  /**
   * 查找批注层元素
   * @returns {Element|null} - 批注层元素或null
   */
  const findAnnotationLayer = () => {
    const wrapper = findScrollContentWrapper();
    const annotationLayer = wrapper
      ? Array.from(wrapper.children).find(element => element.classList.contains('annotation-layer'))
      : null;
    if (!annotationLayer) {
      console.error('[PanelFinder] findAnnotationLayer: 当前 editor 所属 wrapper 中未找到批注层元素');
      return null;
    }
    
    return annotationLayer;
  };

  /**
   * 查找编辑器滚动容器
   * @returns {Element|null} - 编辑器滚动容器元素或null
   */
  const findEditorShell = () => {
    const editorShell = findEditorRoot()?.closest('.editor-shell');
    if (!editorShell) {
      console.error('[PanelFinder] findEditorShell: 当前 editor 未挂载到 .editor-shell');
      return null;
    }
    return editorShell;
  };

  /**
   * 查找滚动内容包装器
   * @returns {Element|null} - 滚动内容包装器元素或null
   */
  const findScrollContentWrapper = () => {
    const wrapper = findEditorRoot()?.closest('.scroll-content-wrapper');
    if (!wrapper) {
      console.error('[PanelFinder] findScrollContentWrapper: 当前 editor 未挂载到 .scroll-content-wrapper');
      return null;
    }
    return wrapper;
  };



  /**
   * 查找批注按钮元素
   * @param {string} blockId - 块ID
   * @returns {Element|null} - 批注按钮元素或null
   */
  const findAnnotationHandle = (blockId) => {
    const blockElement = findBlockElement(blockId);
    if (!blockElement) return null;
    
    const annotationHandle = blockElement.querySelector('.annotation-handle');
    if (!annotationHandle) {
      return null;
    }
    
    return annotationHandle;
  };

  /**
   * 查找批注面板元素
   * @param {string} annotationId - 批注 ID
   * @returns {Element|null} - 批注面板元素或null
   */
  const findAnnotationPanel = (annotationId) => {
    if (!annotationId) {
        return null;
    }

    const annotationLayer = findAnnotationLayer();
    if (!annotationLayer) return null;

    const escapedAnnotationId = escapeCssAttributeValue(annotationId);
    const selector = `.annotation-panel[data-annotation-id="${escapedAnnotationId}"]`;
    const panelElement = annotationLayer.querySelector(selector);
    if (!panelElement) {
      return null;
    }
        
    return panelElement;
  };

  /**
   * 获取元素的位置和尺寸信息
   * @param {Element} element - DOM元素
   * @returns {DOMRect} - 元素的位置和尺寸信息
   */
  const getElementRect = (element) => {
    if (!element) return null;
    return element.getBoundingClientRect();
  };

  /**
   * 获取元素相对于指定参考元素的位置和尺寸
   * @param {HTMLElement} element - 要获取位置的元素
   * @param {HTMLElement} reference - 参考元素，默认为annotation-layer
   * @returns {Object} 位置和尺寸信息
   */
  const getRelativeRect = (element, reference = null) => {
    if (!element) return null;
    
    // 如果未指定参考元素，使用annotation-layer
    if (!reference) {
      reference = findAnnotationLayer();
      if (!reference) return null; // Added check if layer not found
    }
    
    // 获取各自的绝对位置
    const elementRect = getElementRect(element);
    const referenceRect = getElementRect(reference);
    if (!elementRect || !referenceRect) return null; // Added check for rects
    
    // 计算相对位置
    return {
      top: elementRect.top - referenceRect.top,
      left: elementRect.left - referenceRect.left,
      width: elementRect.width,
      height: elementRect.height,
      bottom: elementRect.bottom - referenceRect.top,
      right: elementRect.right - referenceRect.left
    };
  };

  return {
    findEditorRoot,
    findBlockElement,
    findAnnotationLayer,
    findEditorShell, // 暴露新函数
    findScrollContentWrapper,
    findAnnotationHandle,
    findAnnotationPanel,
    getElementRect,
    getRelativeRect,
  };
}

export default createPanelFinder;
