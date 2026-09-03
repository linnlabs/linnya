// apps/renderer/shared/menus/blockActionMenu/service.ts
/**
 * 块操作菜单服务
 * 
 * 职责：
 * - 管理菜单的打开/关闭状态（单例模式）
 * - 确保同一时间只有一个菜单打开
 * - 提供统一的菜单操作接口
 */

import { reactive, readonly } from 'vue';
import type { MenuState, BlockMenuContext, MenuItem } from './types';
import { getMergedMenuItems } from './registry';

/**
 * 菜单状态（响应式）
 */
const state: MenuState = reactive({
  isOpen: false,
  context: null,
  anchorElement: null,
  items: [],
});

interface BlockActionMenuPerfSample {
  kind: 'open' | 'execute';
  itemId?: string;
  blockType?: string;
  itemCount?: number;
  itemsMs?: number;
  actionMs?: number;
  totalMs: number;
  timestamp: number;
}

const MENU_PERF_HISTORY_LIMIT = 60;
const menuPerfHistory: BlockActionMenuPerfSample[] = [];

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function publishMenuPerf(sample: Omit<BlockActionMenuPerfSample, 'timestamp'>): void {
  menuPerfHistory.push({
    ...sample,
    timestamp: nowMs(),
  });
  if (menuPerfHistory.length > MENU_PERF_HISTORY_LIMIT) {
    menuPerfHistory.splice(0, menuPerfHistory.length - MENU_PERF_HISTORY_LIMIT);
  }

  const maybeWindow = typeof window !== 'undefined'
    ? (window as unknown as {
      __BLOCK_ACTION_MENU_PERF__?: {
        getLast: () => BlockActionMenuPerfSample | null;
        getHistory: () => BlockActionMenuPerfSample[];
        clear: () => void;
      };
    })
    : null;

  if (maybeWindow && !maybeWindow.__BLOCK_ACTION_MENU_PERF__) {
    maybeWindow.__BLOCK_ACTION_MENU_PERF__ = {
      getLast: () => menuPerfHistory[menuPerfHistory.length - 1] ?? null,
      getHistory: () => [...menuPerfHistory],
      clear: () => {
        menuPerfHistory.length = 0;
      },
    };
  }
}

/**
 * 菜单服务类
 */
class BlockActionMenuService {
  /**
   * 获取只读的菜单状态
   */
  get state() {
    return readonly(state);
  }

  /**
   * 打开菜单（支持异步）
   * 
   * @param context - 块菜单上下文
   * @param anchorElement - 锚点元素（用于定位菜单）
   */
  async open(context: BlockMenuContext, anchorElement: HTMLElement): Promise<void> {
    const startedAt = nowMs();
    // 如果已经打开，先关闭
    if (state.isOpen) {
      this.close();
    }

    // 获取合并后的菜单项（支持异步）
    const itemsStartedAt = nowMs();
    const items = await getMergedMenuItems(context);
    const itemsMs = nowMs() - itemsStartedAt;

    // 如果没有菜单项，不打开
    if (items.length === 0) {
      // @ts-ignore - import.meta.env 在构建时可用
      if (import.meta.env?.DEV) {
        console.warn('[BlockActionMenu] 没有可用的菜单项，取消打开');
      }
      return;
    }

    // 更新状态
    state.isOpen = true;
    state.context = context;
    state.anchorElement = anchorElement;
    state.items = items;

    publishMenuPerf({
      kind: 'open',
      blockType: context.contentBlockType,
      itemCount: items.length,
      itemsMs: Math.round(itemsMs * 10) / 10,
      totalMs: Math.round((nowMs() - startedAt) * 10) / 10,
    });

    // 添加全局点击监听（点击外部关闭）
    // 延迟添加，避免当前点击事件触发关闭
    setTimeout(() => {
      document.addEventListener('click', this.handleClickOutside, true);
      document.addEventListener('contextmenu', this.handleClickOutside, true);
    }, 100);
  }

  /**
   * 关闭菜单
   */
  close(): void {
    if (!state.isOpen) {
      return;
    }

    state.isOpen = false;
    state.context = null;
    state.anchorElement = null;
    state.items = [];

    // 移除全局点击监听
    document.removeEventListener('click', this.handleClickOutside, true);
    document.removeEventListener('contextmenu', this.handleClickOutside, true);
  }

  /**
   * 切换菜单（如果已打开则关闭，否则打开）
   * 
   * @param context - 块菜单上下文
   * @param anchorElement - 锚点元素
   */
  toggle(context: BlockMenuContext, anchorElement: HTMLElement): void {
    if (state.isOpen) {
      this.close();
    } else {
      this.open(context, anchorElement);
    }
  }

  /**
   * 执行菜单项操作
   * 
   * @param itemId - 菜单项ID
   */
  async executeAction(itemId: string): Promise<void> {
    const startedAt = nowMs();
    
    if (!state.context) {
      console.warn('[BlockActionMenu] 无法执行操作：上下文不存在');
      return;
    }

    // 查找菜单项（支持嵌套）
    const item = this.findMenuItem(state.items, itemId);

    if (!item) {
      console.warn(`[BlockActionMenu] 未找到菜单项: ${itemId}`);
      return;
    }

    // 检查是否禁用
    if (item.disabled) {
      console.warn(`[BlockActionMenu] 菜单项已禁用: ${itemId}`);
      return;
    }

    // 执行操作
    if (item.action) {
      // 保存上下文，因为关闭菜单后会清空
      const context = state.context;

      // 先关闭菜单，解决因 block 删除/清空导致菜单无法关闭的问题
      this.close();

      try {
        const actionStartedAt = nowMs();
        // 使用保存的上下文执行操作
        await item.action(context);
        publishMenuPerf({
          kind: 'execute',
          itemId,
          blockType: context.contentBlockType,
          actionMs: Math.round((nowMs() - actionStartedAt) * 10) / 10,
          totalMs: Math.round((nowMs() - startedAt) * 10) / 10,
        });
      } catch (error) {
        console.error(`[BlockActionMenu] 执行操作失败: ${itemId}`, error);
        // 菜单已提前关闭，此处无需操作
      }
    } else {
      // 如果有子菜单，不关闭
      if (!item.children || item.children.length === 0) {
        this.close();
      }
    }
  }

  /**
   * 查找菜单项（递归）
   * 
   * @param items - 菜单项列表
   * @param itemId - 要查找的菜单项ID
   * @returns 找到的菜单项或 undefined
   */
  private findMenuItem(items: MenuItem[], itemId: string): MenuItem | undefined {
    for (const item of items) {
      if (item.id === itemId) {
        return item;
      }
      
      if (item.children) {
        const found = this.findMenuItem(item.children, itemId);
        if (found) {
          return found;
        }
      }
    }
    
    return undefined;
  }

  /**
   * 处理点击外部（关闭菜单）
   */
  private handleClickOutside = (event: MouseEvent): void => {
    // 检查点击是否在菜单内部
    const target = event.target as HTMLElement;
    
    // 如果点击的是菜单包装器、CustomSelect 或触发器（drag-handle），不关闭
    if (
      target.closest('.block-action-menu-wrapper') || 
      target.closest('.custom-select') ||
      target.closest('.drag-handle') ||
      (state.anchorElement && state.anchorElement.contains(target))
    ) {
      return;
    }

    // 关闭菜单
    this.close();
  };
}

/**
 * 导出单例实例
 */
export const blockActionMenuService = new BlockActionMenuService();
