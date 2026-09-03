// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App, type Ref } from 'vue'
import {
  RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT,
  type RenderVirtualizationKeepAliveEventDetail,
} from '../../RenderVirtualization/state/keepAliveEvents'
import {
  useAnnotationVirtualizationKeepAlive,
  type AnnotationKeepAlivePanel,
  type AnnotationVirtualizationEditor,
  type UseAnnotationVirtualizationKeepAliveReturn,
} from './useAnnotationVirtualizationKeepAlive'

interface RecordedKeepAliveEvent extends RenderVirtualizationKeepAliveEventDetail {
  targetName: string
}

function recordKeepAliveEvents(target: HTMLElement, targetName: string, records: RecordedKeepAliveEvent[]) {
  target.addEventListener(RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT, (event) => {
    if (!(event instanceof CustomEvent)) return
    records.push({
      ...(event.detail as RenderVirtualizationKeepAliveEventDetail),
      targetName,
    })
  })
}

function createEditor(dom: HTMLElement): AnnotationVirtualizationEditor {
  return {
    isDestroyed: false,
    view: { dom },
  }
}

function mountKeepAliveHost(params: {
  editor: Ref<AnnotationVirtualizationEditor | null>
  annotations: Ref<AnnotationKeepAlivePanel[]>
  onApi: (api: UseAnnotationVirtualizationKeepAliveReturn) => void
}): App {
  const Host = defineComponent({
    setup() {
      params.onApi(useAnnotationVirtualizationKeepAlive({
        editor: params.editor,
        annotations: params.annotations,
        activeStates: ['creating', 'editing'],
      }))
      return () => h('div')
    },
  })

  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = createApp(Host)
  app.mount(container)
  return app
}

describe('useAnnotationVirtualizationKeepAlive', () => {
  const mountedApps: App[] = []

  afterEach(() => {
    mountedApps.forEach((app) => app.unmount())
    mountedApps.length = 0
    document.body.innerHTML = ''
  })

  it('pins creating/editing annotation blocks and releases them when no panel needs keep-alive', async () => {
    const records: RecordedKeepAliveEvent[] = []
    const editorDom = document.createElement('div')
    recordKeepAliveEvents(editorDom, 'editor-a', records)

    const editor = ref<AnnotationVirtualizationEditor | null>(createEditor(editorDom))
    const annotations = ref<AnnotationKeepAlivePanel[]>([
      { id: 'anno-a', blockId: 'block-a', state: 'creating' },
      { id: 'anno-b', blockId: 'block-a', state: 'editing' },
    ])

    mountedApps.push(mountKeepAliveHost({
      editor,
      annotations,
      onApi: () => {},
    }))
    await nextTick()

    expect(records).toEqual([
      { blockId: 'block-a', reason: 'annotation', active: true, targetName: 'editor-a' },
    ])

    annotations.value = [
      { id: 'anno-a', blockId: 'block-a', state: 'confirmed' },
      { id: 'anno-b', blockId: 'block-a', state: 'editing' },
    ]
    await nextTick()
    expect(records).toHaveLength(1)

    annotations.value = [
      { id: 'anno-a', blockId: 'block-a', state: 'confirmed' },
      { id: 'anno-b', blockId: 'block-a', state: 'confirmed' },
    ]
    await nextTick()

    expect(records).toEqual([
      { blockId: 'block-a', reason: 'annotation', active: true, targetName: 'editor-a' },
      { blockId: 'block-a', reason: 'annotation', active: false, targetName: 'editor-a' },
    ])
  })

  it('keeps confirmed annotation blocks alive while their panel is hovered', async () => {
    const records: RecordedKeepAliveEvent[] = []
    const editorDom = document.createElement('div')
    recordKeepAliveEvents(editorDom, 'editor-a', records)

    const apiHolder: { api: UseAnnotationVirtualizationKeepAliveReturn | null } = { api: null }
    const editor = ref<AnnotationVirtualizationEditor | null>(createEditor(editorDom))
    const annotations = ref<AnnotationKeepAlivePanel[]>([
      { id: 'anno-a', blockId: 'block-a', state: 'confirmed' },
    ])

    mountedApps.push(mountKeepAliveHost({
      editor,
      annotations,
      onApi: (nextApi) => {
        apiHolder.api = nextApi
      },
    }))
    await nextTick()
    expect(records).toEqual([])

    const api = apiHolder.api
    if (!api) {
      throw new Error('annotation virtualization keep-alive api not mounted')
    }

    api.setPanelHoverState('anno-a', true)
    await nextTick()
    api.setPanelHoverState('anno-a', false)
    await nextTick()

    expect(records).toEqual([
      { blockId: 'block-a', reason: 'annotation', active: true, targetName: 'editor-a' },
      { blockId: 'block-a', reason: 'annotation', active: false, targetName: 'editor-a' },
    ])
  })

  it('releases pins on the previous editor DOM before pinning the next editor DOM', async () => {
    const records: RecordedKeepAliveEvent[] = []
    const editorDomA = document.createElement('div')
    const editorDomB = document.createElement('div')
    recordKeepAliveEvents(editorDomA, 'editor-a', records)
    recordKeepAliveEvents(editorDomB, 'editor-b', records)

    const editor = ref<AnnotationVirtualizationEditor | null>(createEditor(editorDomA))
    const annotations = ref<AnnotationKeepAlivePanel[]>([
      { id: 'anno-a', blockId: 'block-a', state: 'editing' },
    ])

    mountedApps.push(mountKeepAliveHost({
      editor,
      annotations,
      onApi: () => {},
    }))
    await nextTick()

    editor.value = createEditor(editorDomB)
    await nextTick()

    expect(records).toEqual([
      { blockId: 'block-a', reason: 'annotation', active: true, targetName: 'editor-a' },
      { blockId: 'block-a', reason: 'annotation', active: false, targetName: 'editor-a' },
      { blockId: 'block-a', reason: 'annotation', active: true, targetName: 'editor-b' },
    ])
  })
})
