import { computed, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useBlockChromeMountState } from './useBlockChromeMountState'

function createMountState() {
  const isNearViewport = ref(true)
  const isInViewport = ref(true)
  const isInHistoryViewport = ref(true)
  const isKeepAlive = ref(false)
  const isSelected = ref(false)
  const state = useBlockChromeMountState({
    isNearViewport,
    isInViewport,
    isInHistoryViewport,
    isKeepAlive: computed(() => isKeepAlive.value),
    isSelected: computed(() => isSelected.value),
  })

  return {
    isNearViewport,
    isInViewport,
    isInHistoryViewport,
    isKeepAlive,
    isSelected,
    ...state,
  }
}

describe('useBlockChromeMountState', () => {
  it('does not mount immediately from default visibility refs', () => {
    const state = createMountState()

    expect(state.shouldMountBlockChrome.value).toBe(false)
  })

  it('mounts on explicit request and unmounts once all visibility and keep-alive reasons are gone', async () => {
    const state = createMountState()

    state.requestMount()
    expect(state.shouldMountBlockChrome.value).toBe(true)

    state.isNearViewport.value = false
    state.isInViewport.value = false
    state.isInHistoryViewport.value = false
    await nextTick()

    expect(state.shouldMountBlockChrome.value).toBe(false)
  })

  it('keeps chrome mounted while a business keep-alive reason is active', async () => {
    const state = createMountState()

    state.requestMount()
    state.isKeepAlive.value = true
    await nextTick()

    state.isNearViewport.value = false
    state.isInViewport.value = false
    state.isInHistoryViewport.value = false
    await nextTick()

    expect(state.shouldMountBlockChrome.value).toBe(true)

    state.isKeepAlive.value = false
    await nextTick()

    expect(state.shouldMountBlockChrome.value).toBe(false)
  })

  it('mounts when selection reaches a block before visibility observer reports it', async () => {
    const state = createMountState()

    state.isNearViewport.value = false
    state.isInViewport.value = false
    state.isInHistoryViewport.value = false
    await nextTick()

    state.isSelected.value = true
    await nextTick()

    expect(state.shouldMountBlockChrome.value).toBe(true)
  })
})
