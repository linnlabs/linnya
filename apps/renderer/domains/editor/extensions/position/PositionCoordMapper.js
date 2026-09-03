// src/renderer/extensions/position/PositionCoordMapper.js
/**
 * 坐标和位置转换工具
 * 处理视图层与模型层之间的位置映射
 */
export class PositionCoordMapper {
  /**
   * 初始化坐标映射器
   * @param {Editor} editor - Tiptap 编辑器实例
   */
  constructor(editor) {
    this.editor = editor;
    this.view = editor.view;
  }

  /**
   * 根据坐标获取文档位置
   * @param {Object} coords - 坐标对象 {x, y} 或 { left, top }
   * @returns {Object|null} 位置信息或 null
   */
  posAtCoords(coords) {
    try {
      // +++ 增加检查：确保传入的坐标是有效的有限数字 +++
      // ProseMirror 的 view.posAtCoords 可能期望 left/top 属性
      const x = coords.x ?? coords.left; 
      const y = coords.y ?? coords.top; 

      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        console.warn('[PositionCoordMapper] posAtCoords called with non-finite coordinates:', { x, y });
        return null; // 如果坐标无效，则不调用 view.posAtCoords，防止错误
      }
      // +++++++++++++++++++++++++++++++++++++++++++++++

      // 现在坐标有效，可以安全地调用 ProseMirror 的方法
      // 确保传递 left/top 格式
      const pmCoords = { left: x, top: y };
      const pos = this.view.posAtCoords(pmCoords); 
      
      if (!pos) return null;
      
      return {
        pos: pos.pos,
        inside: pos.inside
      };
    } catch (error) {
      // 区分是我们检查出的错误还是 view.posAtCoords 内部的错误
      if (error instanceof TypeError && error.message.includes('non-finite')) {
         console.error('[PositionCoordMapper] Error in view.posAtCoords likely due to internal non-finite calculation:', error);
      } else {
         console.error('[PositionCoordMapper] Error converting coordinates to position:', error);
      }
      return null;
    }
  }

  /**
   * 根据位置获取坐标
   * @param {number} pos - 文档位置
   * @param {boolean} end - 是否获取位置末尾的坐标
   * @returns {Object|null} 坐标对象 {left, right, top, bottom} 或 null
   */
  coordsAtPos(pos, end = false) {
    try {
      const coords = this.view.coordsAtPos(pos, end ? 1 : -1);
      return coords;
    } catch (error) {
      console.error('位置转坐标时出错:', error);
      return null;
    }
  }

  /**
   * 获取节点的矩形区域
   * @param {number} pos - 节点位置
   * @returns {Object|null} 矩形区域 {left, right, top, bottom} 或 null
   */
  getNodeRect(pos) {
    try {
      const node = this.view.nodeDOM(pos);
      if (!node) return null;
      
      return node.getBoundingClientRect();
    } catch (error) {
      console.error('获取节点矩形区域时出错:', error);
      return null;
    }
  }

  /**
   * 获取节点相对于编辑器的位置
   * @param {number} pos - 节点位置
   * @returns {Object|null} 相对位置 {left, top} 或 null
   */
  getRelativeNodePosition(pos) {
    try {
      const nodeRect = this.getNodeRect(pos);
      if (!nodeRect) return null;
      
      const editorRect = this.view.dom.getBoundingClientRect();
      
      return {
        left: nodeRect.left - editorRect.left,
        top: nodeRect.top - editorRect.top,
        width: nodeRect.width,
        height: nodeRect.height
      };
    } catch (error) {
      console.error('获取节点相对位置时出错:', error);
      return null;
    }
  }

  /**
   * 根据事件获取文档位置
   * @param {Event} event - 鼠标或触摸事件
   * @returns {number|null} 文档位置或 null
   */
  posAtEvent(event) {
    try {
      const coords = { x: event.clientX, y: event.clientY };
      const posInfo = this.posAtCoords(coords);
      
      return posInfo ? posInfo.pos : null;
    } catch (error) {
      console.error('事件转位置时出错:', error);
      return null;
    }
  }

  /**
   * 获取光标坐标
   * @returns {Object|null} 光标坐标 {left, right, top, bottom} 或 null
   */
  getCursorCoords() {
    try {
      const { selection } = this.editor.state;
      return this.coordsAtPos(selection.head);
    } catch (error) {
      console.error('获取光标坐标时出错:', error);
      return null;
    }
  }
} 