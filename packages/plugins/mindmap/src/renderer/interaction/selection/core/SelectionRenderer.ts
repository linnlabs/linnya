import type { SelectionOptions } from './types'
import { selectionHelpers } from '../utils'

const { css } = selectionHelpers

/**
 * SelectionRenderer - 选框 DOM 管理器
 * 
 * 职责：创建、挂载、更新、隐藏选框 DOM 元素
 * 
 * DOM 结构：
 * ```
 * clippingElement (裁剪容器，overflow: hidden)
 *   └─ area (选框元素，绝对定位)
 * ```
 * 
 * 选框的坐标是相对于 clippingElement 的相对坐标，
 * 而 clippingElement 本身是绝对定位到拖拽的目标元素位置。
 * 这种双层结构可以实现视觉上的"裁剪"效果，防止选框超出边界显示。
 */
export default class SelectionRenderer {
  /** 选框 DOM 元素（绝对定位，包含选框本身的宽高和位置） */
  readonly area: HTMLElement
  
  /** 裁剪容器（overflow: hidden，用于裁剪超出范围的选框部分） */
  readonly clippingElement: HTMLElement

  /**
   * 构造函数：创建选框 DOM 结构
   * @param options - 选择器配置和文档引用
   */
  constructor(private readonly options: SelectionOptions) {
    const { document, selectionAreaClass, selectionContainerClass } = options

    // ========== 创建 DOM 元素 ==========
    this.area = document.createElement('div')
    this.clippingElement = document.createElement('div')
    this.clippingElement.appendChild(this.area)

    // 添加 CSS 类名
    this.area.classList.add(selectionAreaClass)

    if (selectionContainerClass) {
      this.clippingElement.classList.add(selectionContainerClass)
    }

    // ========== 样式化选框元素 ==========
    css(this.area, {
      willChange: 'top, left, bottom, right, width, height',  // 提示浏览器这些属性会频繁变化，优化性能
      top: 0,
      left: 0,
      position: 'absolute',  // 相对于 clippingElement 的绝对定位
    })

    // ========== 样式化裁剪容器 ==========
    css(this.clippingElement, {
      overflow: 'hidden',  // 隐藏超出范围的内容（实现裁剪效果）
      position: 'absolute',  // 绝对定位到拖拽的目标元素
      // 注意：transform: translate3d(0, 0, 0) 用于启用硬件加速
      // 通过强制 3D 变换让浏览器使用 GPU 渲染，提高性能
      // 虽然这里没有真正的 3D 移动，但可以加快频繁更新的渲染
      // 权衡：在某些浏览器中可能导致文本模糊或其他副作用，需要测试确认
      transform: 'translate3d(0, 0, 0)',
      pointerEvents: 'none',  // 穿透鼠标事件，不影响底层元素的交互
      zIndex: '1',  // 确保选框显示在内容上方
    })
  }

  /**
   * 设置选框的初始状态
   * 
   * 将 clippingElement 定位到拖拽的目标元素位置，
   * 并调整坐标以相对于其 offsetParent
   * 
   * @param targetRect - 拖拽目标元素的边界矩形
   * @param targetElement - 拖拽目标元素
   */
  setupSelectionArea(targetRect: DOMRect, targetElement: Element): void {
    const { clippingElement, area } = this
    let top = targetRect.top
    let left = targetRect.left

    // 获取 clippingElement 的定位父元素（offsetParent）
    // offsetParent 是第一个 position 不为 static 的祖先元素
    const offsetParent = clippingElement.offsetParent as HTMLElement
    const { document } = this.options

    /**
     * 坐标系说明（这是本次“选框偏移”的根因）：
     * - targetRect 使用 getBoundingClientRect()，是“视口坐标”
     * - clippingElement 是 absolute 定位，且挂载在 options.container 内（通常是 mind.container）
     * - 当画布平移采用 `container.scrollBy(...)` 时，container 会累积 scrollLeft/scrollTop，
     *   absolute 元素会跟随“滚动内容坐标系”，导致视觉上选框整体偏移（常见表现：偏到鼠标左侧很多）
     *
     * 解决：
     * - 将 clippingElement 的 top/left 计算为：
     *   (视口坐标转换为 offsetParent 坐标) + offsetParent.scrollTop/scrollLeft
     * - 这样 clippingElement 会稳定贴在容器“可视区域”，不随滚动内容漂移
     */

    // 如果 offsetParent 不是 document.body 或 html 元素
    // 需要将坐标从视口相对转换为相对于 offsetParent
    if (offsetParent && offsetParent !== document.body && offsetParent !== document.documentElement) {
      const parentRect = offsetParent.getBoundingClientRect()
      const style = window.getComputedStyle(offsetParent)

      // 考虑 offsetParent 的边框（border）
      const borderTop = parseFloat(style.borderTopWidth) || 0
      const borderLeft = parseFloat(style.borderLeftWidth) || 0

      // 转换坐标：从视口相对 → offsetParent 相对
      top -= parentRect.top + borderTop
      left -= parentRect.left + borderLeft

      // 关键：补偿 scroll（将坐标从“内容坐标系”移回“视口坐标系”）
      top += offsetParent.scrollTop
      left += offsetParent.scrollLeft
    }

    // 设置 clippingElement 的位置和尺寸
    // clippingElement 作为选框的容器，其边界就是拖拽目标元素的边界
    css(clippingElement, {
      top,
      left,
      width: targetRect.width,
      height: targetRect.height,
    })

    // 重置 area 的 margin（选框元素应该没有外边距，完全由 left/top 定位）
    css(area, {
      marginTop: 0,
      marginLeft: 0,
    })
  }

  /**
   * 重绘选框（实时更新选框的大小和位置）
   * 
   * 这个方法在每一帧拖拽过程中被调用，用 areaRect 中的绝对坐标
   * 计算相对于 targetRect 的相对坐标，然后更新选框 DOM
   * 
   * @param areaRect - 选框的绝对坐标（通过滚动调整后的全局坐标）
   * @param targetRect - 拖拽目标元素的边界矩形
   */
  redrawSelectionArea(areaRect: DOMRect, targetRect?: DOMRect): void {
    if (!targetRect) return
    const { x, y, width, height } = areaRect
    const { style } = this.area

    // 将绝对坐标转换为相对于 clippingElement（targetRect）的相对坐标
    const left = x - targetRect.left
    const top = y - targetRect.top

    // 更新选框的位置和尺寸
    style.left = `${left}px`
    style.top = `${top}px`
    style.width = `${width}px`
    style.height = `${height}px`
  }

  /**
   * 将选框挂载到指定容器（将 DOM 插入页面）
   * @param container - 要挂载的容器元素
   */
  mount(container: Element): void {
    container.appendChild(this.clippingElement)
  }

  /**
   * 从 DOM 树中移除选框元素
   */
  remove(): void {
    this.clippingElement.remove()
  }

  /**
   * 隐藏选框（设置 display: none）
   */
  hide(): void {
    css(this.area, 'display', 'none')
  }
}
