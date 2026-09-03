/**
 * @input: 带有层级结构的思维导图数据，包含父节点、子节点和孙子节点
 * @output: 批量删除操作后的节点数据结构和 DOM 状态验证，确保不会因为父节点被删除而导致子节点删除报错或布局残留
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import MindMap from '../core'
import { useMindMapStore } from '../domain/store/mindmapStore'
import type { MindMapData, MindMapInstance, Options } from '../domain/types/index'

describe('MindMap Operations - 批量删除', () => {
  let container: HTMLElement
  let mindMap: MindMapInstance | null

  beforeEach(() => {
    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
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
    
    // 初始化一个多层级的数据结构
    // Root
    //  |- Node 1
    //      |- Node 1-1
    //      |- Node 1-2
    //  |- Node 2
    const data: MindMapData = {
      nodeData: {
        id: 'root',
        topic: 'Root',
        children: [
          {
            id: 'node1',
            topic: 'Node 1',
            children: [
              { id: 'node1-1', topic: 'Node 1-1' },
              { id: 'node1-2', topic: 'Node 1-2' }
            ]
          },
          {
            id: 'node2',
            topic: 'Node 2'
          }
        ]
      }
    }
    // 中文说明：通过 store 设置文档会话，确保 documentId 就绪
    const store = useMindMapStore()
    store.setMind(mindMap)
    store.setDocumentSession({
      documentId: 'test-doc',
      name: 'Batch Delete',
      content: data,
    })
  })

  afterEach(() => {
    // Cleanup
    if (mindMap) {
      mindMap.destroy()
      mindMap = null
    }
    document.body.removeChild(container)
    container.remove()
  })

  it('应当能够同时删除父节点及其子节点而不报错', () => {
    const instance = mindMap!
    // 获取节点引用
    const node1El = instance.findEle('node1')
    const node1_1El = instance.findEle('node1-1')
    const node1_2El = instance.findEle('node1-2')
    
    // 模拟框选选中了父节点 Node 1 以及它的所有子节点
    // 这是一个常见的导致报错的场景：如果先删除了父节点，再去删除子节点时找不到父容器
    const selectedNodes = [node1El, node1_1El, node1_2El]
    
    // 验证初始状态
    const children = instance.nodeData.children ?? []
    expect(children.length).toBe(2)
    expect(children[0]?.children?.length ?? 0).toBe(2)
    
    // 执行批量删除
    // 输入：包含父子依赖关系的节点数组
    instance.removeNodes(selectedNodes)
    
    // 期望输出：
    // 1. 操作不应抛出异常（通过测试即证明）
    // 2. 根节点下只剩 Node 2
    const remaining = instance.nodeData.children ?? []
    expect(remaining.length).toBe(1)
    expect(remaining[0]?.id).toBe('node2')
    
    // 3. DOM 中不应残留被删除的节点
    expect(container.querySelector('[data-nodeid="menode1"]')).toBeFalsy()
    expect(container.querySelector('[data-nodeid="menode1-1"]')).toBeFalsy()
    expect(container.querySelector('[data-nodeid="menode1-2"]')).toBeFalsy()
  })

  it('应当能够删除全部子节点并正确清理父容器结构', () => {
    const instance = mindMap!
    // 这个测试用例验证 removeNodeDom 中对 siblingLength === 0 的处理逻辑
    const node1_1El = instance.findEle('node1-1')
    const node1_2El = instance.findEle('node1-2')
    
    // 选中所有子节点
    const selectedNodes = [node1_1El, node1_2El]
    
    // 执行删除
    instance.removeNodes(selectedNodes)
    
    // 期望输出：
    // 1. 父节点 Node 1 还在，但没有子节点了
    const node1Data = (instance.nodeData.children ?? [])[0]
    expect(node1Data.id).toBe('node1')
    expect(node1Data.children ?? []).toHaveLength(0)
    
    // 2. 验证 expander 是否被移除（因为没有子节点了）
    const node1El = instance.findEle('node1')
    const expander = node1El.parentElement.querySelector('mm-expander')
    // 注意：在当前的实现中，如果子节点被清空，expander 应该被移除
    // 这里通过 DOM 查找确认 expander 是否还存在
    expect(expander).toBeFalsy()
  })
  
  it('应当能够处理乱序的批量删除', () => {
    const instance = mindMap!
    // 模拟乱序选中（先子后父，或者混合）
    const node1El = instance.findEle('node1')
    const node1_1El = instance.findEle('node1-1')
    
    // 顺序：先子后父
    const selectedNodes = [node1_1El, node1El]
    
    instance.removeNodes(selectedNodes)
    
    // 验证结果应与有序删除一致
    const remaining = instance.nodeData.children ?? []
    expect(remaining.length).toBe(1)
    expect(remaining[0]?.id).toBe('node2')
  })
})
