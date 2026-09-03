/**
 * @input: A MindMap instance with data
 * @output: Successful node operations (addChild, sibling) and verify DOM updates
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import MindMap from '../core'
import { useMindMapStore } from '../domain/store/mindmapStore'
import type { MindMapData, MindMapInstance, Options } from '../domain/types/index'

describe('MindMap Operations', () => {
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
    
    const data: MindMapData = {
      nodeData: {
        id: 'root',
        topic: 'Root',
        children: []
      }
    }
    // 中文说明：通过 store 设置文档会话，确保 documentId 就绪
    const store = useMindMapStore()
    store.setMind(mindMap)
    store.setDocumentSession({
      documentId: 'test-doc',
      name: 'Operations',
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

  it('should add a child node to root', () => {
    const instance = mindMap!
    const rootNode = instance.findEle('root')
    expect(rootNode).toBeTruthy()
    
    // Mock selection
    instance.selectNode(rootNode)
    expect(instance.currentNodes.length).toBe(1)
    
    // Perform addChild operation
    instance.addChild(rootNode)
    
    // Verify data model
    const children = instance.nodeData.children ?? []
    expect(children.length).toBe(1)
    const newNodeId = children[0]!.id
    
    // Verify DOM
    // We need to force layout update or wait if it's async. 
    // In standard implementation it's synchronous unless batched.
    
    // Check if new node element exists
    // Note: logic might rely on findEle using the ID
    const newNodeEl = instance.findEle(newNodeId)
    expect(newNodeEl).toBeTruthy()
    expect(newNodeEl.textContent).toContain('子主题') // 新建节点的默认占位
  })

  it('should insert a sibling node', () => {
    const instance = mindMap!
    // First add a child so we can add a sibling to it
    const rootNode = instance.findEle('root')
    instance.addChild(rootNode)
    
    const childNodeData = (instance.nodeData.children ?? [])[0]
    const childEl = instance.findEle(childNodeData.id)
    
    instance.selectNode(childEl)
    instance.insertSibling('after', childEl)
    
    const children = instance.nodeData.children ?? []
    expect(children.length).toBe(2)
    
    const siblingData = children[1]
    const siblingEl = instance.findEle(siblingData.id)
    expect(siblingEl).toBeTruthy()
  })
  
  it('should remove a node', () => {
     const instance = mindMap!
     // Add a child first
     const rootNode = instance.findEle('root')
     instance.addChild(rootNode)
     const childNodeData = (instance.nodeData.children ?? [])[0]
     const childEl = instance.findEle(childNodeData.id)
     
     instance.selectNode(childEl)
     instance.removeNodes([childEl])
     
     expect((instance.nodeData.children ?? []).length).toBe(0)
     // 中文说明：DOM 属性统一使用 domId（me 前缀）
     expect(container.querySelector(`[data-nodeid="me${childNodeData.id}"]`)).toBeFalsy()
  })
})
