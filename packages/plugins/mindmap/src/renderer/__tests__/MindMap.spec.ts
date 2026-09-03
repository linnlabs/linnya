/**
 * @input: A container element and basic MindMap options
 * @output: A successfully initialized MindMap instance with DOM structure
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import MindMap from '../core'
import { useMindMapStore } from '../domain/store/mindmapStore'
import type { MindMapData, MindMapInstance, Options } from '../domain/types/index'

describe('MindMap Integration', () => {
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

    // Setup DOM
    container = document.createElement('div')
    container.id = 'map'
    container.style.width = '800px'
    container.style.height = '600px'
    document.body.appendChild(container)
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

  it('should initialize correctly with valid options', () => {
    const options: Options = {
      el: container,
      direction: 1,
    }
    
    mindMap = new MindMap(options)

    // 中文说明：绑定 store，保证文档上下文可用
    const store = useMindMapStore()
    store.setMind(mindMap)
    
    expect(mindMap).toBeDefined()
    expect(mindMap.el).toBe(container)
    // Check key DOM elements
    expect(container.querySelector('.map-container')).toBeTruthy()
    expect(container.querySelector('.map-canvas')).toBeTruthy()
    expect(container.querySelector('me-nodes')).toBeTruthy()
  })

  it('should initialize with data and render root node', () => {
    const options: Options = { el: container }
    mindMap = new MindMap(options)

    const store = useMindMapStore()
    store.setMind(mindMap)
    
    const data: MindMapData = {
      nodeData: {
        id: 'root',
        topic: 'Root Topic',
        children: []
      }
    }
    
    store.setDocumentSession({
      documentId: 'test-doc',
      name: 'MindMap Integration',
      content: data,
    })
    
    // Check if root node is rendered
    const rootNode = container.querySelector('mm-root')
    expect(rootNode).toBeTruthy()
    
    // Note: The implementation might render the topic inside a child element of mm-root
    // Let's check innerText or traverse down
    const topicText = rootNode?.textContent
    expect(topicText).toContain('Root Topic')
  })
  
  it('should expose version', () => {
    expect(MindMap.version).toBeDefined()
  })
})
