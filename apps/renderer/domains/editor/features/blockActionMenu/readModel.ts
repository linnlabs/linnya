import { computed, type ComputedRef } from 'vue';
import { blockActionMenuService } from './service';
import { readRootBlockIdFromMenuContext } from './functions/readRootBlockIdFromMenuContext';

/**
 * 块操作菜单的只读运行态。
 *
 * 中文说明：BlockChromeHost 只需要知道“当前菜单是否要求某个 block 保持 chrome”，
 * 不应该 import 带 provider 注册副作用的 feature 总入口。
 */
export function useOpenBlockActionMenuRootBlockId(): ComputedRef<string | null> {
  return computed(() => {
    if (!blockActionMenuService.state.isOpen) return null;
    return readRootBlockIdFromMenuContext(blockActionMenuService.state.context);
  });
}
