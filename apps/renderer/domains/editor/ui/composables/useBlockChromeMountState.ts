import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

export interface UseBlockChromeMountStateOptions {
  isNearViewport: Ref<boolean>
  isInViewport: Ref<boolean>
  isInHistoryViewport: Ref<boolean>
  isKeepAlive: ComputedRef<boolean>
  isSelected: ComputedRef<boolean>
}

export interface UseBlockChromeMountStateReturn {
  shouldMountBlockChrome: ComputedRef<boolean>
  requestMount: () => void
}

/**
 * 管理 Vue BlockChrome 的可回收挂载状态。
 *
 * 中文说明：
 * - useBlockVisibilityManager 的初始值是 true，用来避免未初始化时误隐藏 UI；
 * - 因此这里不能用 `immediate` watcher，也不能直接 `v-if=isNearViewport`，
 *   否则大文档会一次性挂载所有 BlockChrome；
 * - 只有真实的进入视口事件、初始几何检查、选中或业务保活会主动 mount；
 * - 离开视口后，如果没有 selected / keepAlive / history 等原因，就真正 unmount，
 *   释放 BlockChrome 内部的 editor.on 监听和重型 composable。
 */
export function useBlockChromeMountState(
  options: UseBlockChromeMountStateOptions
): UseBlockChromeMountStateReturn {
  const mounted = ref(false)

  const shouldStayMounted = computed(() => {
    return (
      options.isNearViewport.value ||
      options.isInViewport.value ||
      options.isInHistoryViewport.value ||
      options.isKeepAlive.value ||
      options.isSelected.value
    )
  })

  function requestMount(): void {
    mounted.value = true
  }

  function releaseIfIdle(): void {
    if (shouldStayMounted.value) return
    mounted.value = false
  }

  watch(
    [
      options.isNearViewport,
      options.isInViewport,
      options.isInHistoryViewport,
      options.isKeepAlive,
      options.isSelected,
    ],
    ([nearViewport, inViewport, historyViewport, keepAlive, selected]) => {
      if (nearViewport || inViewport || historyViewport || keepAlive || selected) {
        requestMount()
        return
      }
      releaseIfIdle()
    },
    { immediate: false }
  )

  return {
    shouldMountBlockChrome: computed(() => mounted.value),
    requestMount,
  }
}
