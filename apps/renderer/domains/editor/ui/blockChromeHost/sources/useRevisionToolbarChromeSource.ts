import type { Ref } from 'vue'
import { useRevisionToolbarRootBlockIds } from '../../../features/Revision/readModel'

/**
 * 块级修订工具栏对应的 active chrome 来源。
 */
export function useRevisionToolbarChromeSource(): Ref<readonly string[]> {
  return useRevisionToolbarRootBlockIds()
}
