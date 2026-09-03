import type { ComputedRef } from 'vue';
import { useOpenBlockActionMenuRootBlockId } from '../../../features/blockActionMenu/readModel';

/**
 * 块操作菜单对应的 active chrome 来源。
 *
 * 中文说明：这里通过 blockActionMenu 的公开服务读取当前菜单上下文，不从
 * DOM / body dataset 反推 blockId，避免 Host 和旧拖拽柄 DOM 结构绑定。
 */
export function useBlockActionMenuChromeSource(): ComputedRef<string | null> {
  return useOpenBlockActionMenuRootBlockId();
}
