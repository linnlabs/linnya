// apps/renderer/shared/menus/blockActionMenu/types.ts
/**
 * 块操作菜单的类型定义
 */

import type { Editor } from '@tiptap/vue-3';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * 块菜单上下文
 * 包含执行菜单操作所需的所有信息
 */
export interface BlockMenuContext {
  /** 编辑器实例 */
  editor: Editor;
  
  /** rootBlock 节点 */
  rootBlockNode: ProseMirrorNode;
  
  /** rootBlock 在文档中的位置 */
  rootBlockPos: number;
  
  /** 内容块类型（baseBlock, audioBlock 等） */
  contentBlockType: string;
  
  /** 内容块节点 */
  contentBlockNode: ProseMirrorNode;
  
  /** 内容块在文档中的位置 */
  contentBlockPos: number;

  /** 块是否已有批注 */
  hasAnnotations?: boolean;
}

/**
 * 菜单项定义
 */
export interface MenuItem {
  /** 菜单项唯一标识 */
  id: string;
  
  /** 显示的文本 */
  label: string;
  
  /** 快捷键提示文本（可选） */
  shortcut?: string;
  
  /** 菜单项类型 */
  type?: 'action' | 'separator' | 'group';
  
  /** 点击时执行的操作 */
  action?: (ctx: BlockMenuContext) => void | Promise<void>;
  
  /** 是否禁用 */
  disabled?: boolean | ((ctx: BlockMenuContext) => boolean);
  
  /** 是否可见 */
  visible?: boolean | ((ctx: BlockMenuContext) => boolean);
  
  /** 子菜单项（用于嵌套菜单） */
  children?: MenuItem[] | any[];
  
  /** 是否为面板模式（子菜单作为信息展示面板） */
  isPanel?: boolean;

  /** [颜色选择器专属] 是否为颜色选择器 */
  isColorPicker?: boolean;

  /** [颜色选择器专属] 当前背景色 */
  currentBackgroundColor?: string | null;

  /** [颜色选择器专属] 当前文字色 */
  currentTextColor?: string | null;

  /** [颜色选择器专属] 块内是否存在任意文字颜色（textColor mark 或块级 textColor） */
  hasTextColor?: boolean;

  /** [颜色选择器专属] 块是否为原子块 */
  isAtomic?: boolean;
  
  /** 图标（可选） */
  icon?: string;
  
  /** 样式变体（可选） */
  variant?: 'default' | 'danger';
}

/**
 * 块菜单 Provider
 * 用于注册菜单项的提供者
 */
export interface BlockMenuProvider {
  /** Provider 名称（用于避免重复注册） */
  name?: string;
  
  /** 权重，用于排序（数值越小越靠前） */
  weight?: number;
  
  /** 获取菜单项的函数（支持异步） */
  getItems: (ctx: BlockMenuContext) => MenuItem[] | Promise<MenuItem[]>;
}

/**
 * 菜单状态
 * 用于管理菜单的全局状态
 */
export interface MenuState {
  /** 菜单是否打开 */
  isOpen: boolean;
  
  /** 当前块的上下文信息 */
  context: BlockMenuContext | null;
  
  /** 菜单锚点元素（通常是 drag-handle） */
  anchorElement: HTMLElement | null;
  
  /** 当前显示的菜单项列表 */
  items: MenuItem[];
}
