// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App, type Ref } from 'vue'
import {
  RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT,
  type RenderVirtualizationKeepAliveEventDetail,
} from './keepAliveEvents'
import {
  RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY,
  type RenderVirtualizationKeepAlivePort,
} from './keepAlivePort'
import { useRenderVirtualizationKeepAliveLease } from './useRenderVirtualizationKeepAliveLease'

interface RecordedKeepAliveEvent extends RenderVirtualizationKeepAliveEventDetail {
  targetName: string
}

function recordKeepAliveEvents(target: HTMLElement, targetName: string, records: RecordedKeepAliveEvent[]): void {
  target.addEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, (event) => {
    if (!(event instanceof CustomEvent)) return
    records.push({
      ...event.detail as RenderVirtualizationKeepAliveEventDetail,
      targetName,
    })
  })
}

function mountLeaseHost(params: {
  target: Ref<EventTarget | null>
  fallbackTarget?: Ref<EventTarget | null>
  blockId: Ref<string | null>
  active: Ref<boolean>
  keepAlivePort?: RenderVirtualizationKeepAlivePort
}): App {
  const Host = defineComponent({
    setup() {
      useRenderVirtualizationKeepAliveLease({
        target: params.target,
        fallbackTarget: params.fallbackTarget,
        blockId: params.blockId,
        reason: 'revision-toolbar',
        active: params.active,
      })
      return () => h('div')
    },
  })

  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createApp(Host)
  if (params.keepAlivePort) {
    app.provide(RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY, params.keepAlivePort)
  }
  app.mount(container)
  return app
}

describe('useRenderVirtualizationKeepAliveLease', () => {
  const mountedApps: App[] = []

  afterEach(() => {
    mountedApps.forEach((app) => app.unmount())
    mountedApps.length = 0
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('does not mark a lease as acquired while target is missing, then acquires after target appears', async () => {
    const records: RecordedKeepAliveEvent[] = []
    const editorDom = document.createElement('div')
    recordKeepAliveEvents(editorDom, 'editor-a', records)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const target = ref<EventTarget | null>(null)
    const blockId = ref<string | null>('block-a')
    const active = ref(true)

    mountedApps.push(mountLeaseHost({ target, blockId, active }))
    await nextTick()

    expect(records).toEqual([])
    expect(warnSpy).toHaveBeenCalledTimes(1)

    target.value = editorDom
    await nextTick()

    expect(records).toEqual([
      { blockId: 'block-a', reason: 'revision-toolbar', active: true, targetName: 'editor-a' },
    ])
  })

  it('releases the original target when retargeting or unmounting', async () => {
    const records: RecordedKeepAliveEvent[] = []
    const editorDomA = document.createElement('div')
    const editorDomB = document.createElement('div')
    recordKeepAliveEvents(editorDomA, 'editor-a', records)
    recordKeepAliveEvents(editorDomB, 'editor-b', records)

    const target = ref<EventTarget | null>(editorDomA)
    const blockId = ref<string | null>('block-a')
    const active = ref(true)

    const app = mountLeaseHost({ target, blockId, active })
    mountedApps.push(app)
    await nextTick()

    target.value = editorDomB
    blockId.value = 'block-b'
    await nextTick()

    expect(records).toEqual([
      { blockId: 'block-a', reason: 'revision-toolbar', active: true, targetName: 'editor-a' },
      { blockId: 'block-a', reason: 'revision-toolbar', active: false, targetName: 'editor-a' },
      { blockId: 'block-b', reason: 'revision-toolbar', active: true, targetName: 'editor-b' },
    ])

    app.unmount()
    mountedApps.pop()
    await nextTick()

    expect(records).toEqual([
      { blockId: 'block-a', reason: 'revision-toolbar', active: true, targetName: 'editor-a' },
      { blockId: 'block-a', reason: 'revision-toolbar', active: false, targetName: 'editor-a' },
      { blockId: 'block-b', reason: 'revision-toolbar', active: true, targetName: 'editor-b' },
      { blockId: 'block-b', reason: 'revision-toolbar', active: false, targetName: 'editor-b' },
    ])
  })

  it('releases through fallback target when the leased target is detached', async () => {
    const records: RecordedKeepAliveEvent[] = []
    const editorDom = document.createElement('div')
    const teleportedTarget = document.createElement('button')
    document.body.appendChild(teleportedTarget)
    recordKeepAliveEvents(editorDom, 'editor-root', records)
    recordKeepAliveEvents(teleportedTarget, 'teleported-target', records)

    const target = ref<EventTarget | null>(teleportedTarget)
    const fallbackTarget = ref<EventTarget | null>(editorDom)
    const blockId = ref<string | null>('block-a')
    const active = ref(true)

    const app = mountLeaseHost({ target, fallbackTarget, blockId, active })
    mountedApps.push(app)
    await nextTick()

    teleportedTarget.remove()
    active.value = false
    await nextTick()

    expect(records).toEqual([
      { blockId: 'block-a', reason: 'revision-toolbar', active: true, targetName: 'teleported-target' },
      { blockId: 'block-a', reason: 'revision-toolbar', active: false, targetName: 'editor-root' },
    ])
  })

  it('uses injected keepAlive port instead of DOM bubbling when available', async () => {
    const records: Array<{ active: boolean; blockId: string }> = []
    const keepAlivePort: RenderVirtualizationKeepAlivePort = {
      acquire(command) {
        records.push({ active: true, blockId: command.blockId })
        return true
      },
      release(command) {
        records.push({ active: false, blockId: command.blockId })
        return true
      },
      releaseReason() {
        return []
      },
      hasReason() {
        return false
      },
    }
    const target = ref<EventTarget | null>(null)
    const blockId = ref<string | null>('block-a')
    const active = ref(true)

    const app = mountLeaseHost({ target, blockId, active, keepAlivePort })
    mountedApps.push(app)
    await nextTick()

    expect(records).toEqual([{ active: true, blockId: 'block-a' }])

    active.value = false
    await nextTick()

    expect(records).toEqual([
      { active: true, blockId: 'block-a' },
      { active: false, blockId: 'block-a' },
    ])
  })
})
