/**
 * @input: 选区同时包含 root + 普通节点
 * @output: removeSelected 只删除普通节点，root 保持不变
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import MindMap from '../core'
import { useMindMapStore } from '../domain/store/mindmapStore'
import type { MindMapData, MindMapInstance, Options } from '../domain/types/index'

describe('MindMap Commands - node.removeSelected', () => {
  let container: HTMLElement
  let mindMap: MindMapInstance

  beforeEach(() => {
    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    // 中文说明：MindMapEngine 依赖 Pinia，需要提前激活
    setActivePinia(createPinia())

    container = document.createElement('div')
    container.id = 'map'
    container.style.width = '1000px'
    container.style.height = '800px'
    document.body.appendChild(container)

    const options: Options = {
      el: container,
      direction: 1,
    }
    mindMap = new MindMap(options)

    const data: MindMapData = {
      nodeData: {
        id: 'root',
        topic: 'Root',
        children: [
          {
            id: 'node1',
            topic: 'Node 1',
            children: [{ id: 'node1-1', topic: 'Node 1-1' }],
          },
          {
            id: 'node2',
            topic: 'Node 2',
          },
        ],
      },
    }
    // 中文说明：通过 store 设置文档会话，确保 documentId 就绪
    const store = useMindMapStore()
    store.setMind(mindMap)
    store.setDocumentSession({
      documentId: 'test-doc',
      name: 'Test Doc',
      content: data,
    })
  })

  afterEach(() => {
    if (mindMap) {
      mindMap.destroy()
      mindMap = null
    }
    document.body.removeChild(container)
    container.remove()
  })

  it('应当忽略 root，仅删除普通节点', () => {
    const rootEl = container.querySelector('mm-root > mm-topic') as HTMLElement
    const node1El = mindMap.findEle('node1')

    // 中文说明：模拟选区包含 root + 普通节点
    mindMap.currentNodes = [rootEl, node1El]

    // 执行命令删除
    const result = mindMap.commands.node.removeSelected({}, { source: 'script' })
    expect(result.ok).toBe(true)

    // root 必须保留，node2 必须保留，node1 及其子树必须移除
    expect(mindMap.nodeData.id).toBe('root')
    expect(mindMap.nodeData.children.length).toBe(1)
    expect(mindMap.nodeData.children[0].id).toBe('node2')

    // DOM 校验：node1 不存在，node2 仍存在
    expect(container.querySelector('[data-nodeid="menode1"]')).toBeFalsy()
    expect(container.querySelector('[data-nodeid="menode1-1"]')).toBeFalsy()
    expect(container.querySelector('[data-nodeid="menode2"]')).toBeTruthy()
  })

  it('删除节点后应优先选中同级节点（而不是父节点）', () => {
    const node1El = mindMap.findEle('node1')
    mindMap.currentNodes = [node1El]

    const result = mindMap.commands.node.removeSelected({}, { source: 'script' })
    expect(result.ok).toBe(true)

    // 数据：node1 被删除，只剩 node2
    const children = mindMap.nodeData.children ?? []
    expect(children).toHaveLength(1)
    expect(children[0]!.id).toBe('node2')

    // 选中：应选中同级节点 node2
    expect(mindMap.currentNodes).toHaveLength(1)
    expect(mindMap.currentNodes[0]!.nodeObj.id).toBe('node2')
  })
})
