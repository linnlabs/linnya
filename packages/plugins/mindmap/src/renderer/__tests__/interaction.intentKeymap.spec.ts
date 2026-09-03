/**
 * MindMap Phase 2：Intent / Keymap 基础设施测试
 */
// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import type { MindMapInstance, NodeObj } from '../domain/types/index'
import type { Expander, Topic } from '../domain/types/dom'
import {
  MOD_KEY,
  parseKeyBinding,
  parseKeySequence,
  extractKeyBinding,
  keyBindingsMatch,
} from '../interaction/keyboard/keybinding'
import {
  routeClickToIntent,
  routeDblClickToIntent,
  routeWheelToIntent,
} from '../interaction/intents/intentRouter'
import { createIntent } from '../interaction/intents/types'
import { IntentDispatcher } from '../interaction/intents/intentDispatcher'
import { KeymapRegistry } from '../interaction/keyboard/KeymapRegistry'

describe('MindMap Phase 2 - Keybinding', () => {
  it('should parse keybinding with Mod correctly', () => {
    const parsed = parseKeyBinding('Mod+Shift+K')
    expect(parsed.key).toBe('k')
    expect(parsed.modifiers.has(MOD_KEY)).toBe(true)
    expect(parsed.modifiers.has('shift')).toBe(true)
  })

  it('should parse key sequence correctly', () => {
    const parsed = parseKeySequence('Mod+K Mod+0')
    expect(parsed.bindings.length).toBe(2)
    expect(parsed.bindings[0].key).toBe('k')
    expect(parsed.bindings[1].key).toBe('0')
  })

  it('should match extracted keybinding from KeyboardEvent', () => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true })
    const extracted = extractKeyBinding(event)
    const target = parseKeyBinding('Ctrl+Enter')
    expect(keyBindingsMatch(extracted, target)).toBe(true)
  })
})

describe('MindMap Phase 2 - KeymapRegistry', () => {
  it('should fallback to lower priority item when run returns false', () => {
    // 中文说明：
    // - 这是撤消/恢复失效的根因回归用例：
    //   evidence.undo (高优先级) 返回 false，希望继续执行 history.undo (低优先级)。
    // - 若 registry 不支持链式匹配，Mod+Z 将被 evidence.undo 吞掉，导致撤消看起来失效。
    const container = document.createElement('div')

    const mind = {
      container,
      editable: true,
      currentNodes: [],
      currentArrow: null,
      currentSummary: null,
    } as unknown as MindMapInstance

    const registry = new KeymapRegistry(mind)

    let calledLow = false

    registry.registerMany([
      {
        id: 'high',
        binding: 'Mod+Z',
        priority: 10,
        run: () => false, // 继续 fallback
      },
      {
        id: 'low',
        binding: 'Mod+Z',
        priority: -10,
        run: () => {
          calledLow = true
          return true
        },
      },
    ])

    // 中文说明：Mod 在不同平台映射不同（Mac=Meta，其它=Ctrl），测试需按运行环境构造 event
    const event =
      MOD_KEY === 'meta'
        ? new KeyboardEvent('keydown', { key: 'z', metaKey: true })
        : new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })
    const ctx = registry.createContext(false)
    const handled = registry.handleKeyDown(event, ctx)

    expect(handled).toBe(true)
    expect(calledLow).toBe(true)
  })
})

describe('MindMap Phase 2 - IntentRouter', () => {
  it('should route expander click to node:toggleExpand intent', () => {
    const container = document.createElement('div')
    const topic = document.createElement('mm-topic') as Topic
    topic.nodeObj = { id: 'node-1', topic: 'N1' } as NodeObj
    const expander = document.createElement('mm-expander') as Expander
    container.append(topic, expander)

    const event = new MouseEvent('click')
    Object.defineProperty(event, 'target', { value: expander })

    const mind = { container } as MindMapInstance
    const result = routeClickToIntent(event, mind)

    expect(result.matched).toBe(true)
    if (result.matched) {
      expect(result.intent.name).toBe('node:toggleExpand')
      expect(result.intent.payload).toEqual({ nodeId: 'node-1' })
    }
  })

  it('should route arrow label click to arrow:select intent', () => {
    const container = document.createElement('div')
    const label = document.createElement('span')
    label.className = 'svg-label'
    label.dataset.svgId = 'arrow-1'
    label.dataset.type = 'arrow'
    container.append(label)

    const event = new MouseEvent('click')
    Object.defineProperty(event, 'target', { value: label })

    const mind = { container } as MindMapInstance
    const result = routeClickToIntent(event, mind)

    expect(result.matched).toBe(true)
    if (result.matched) {
      expect(result.intent.name).toBe('arrow:select')
      expect(result.intent.payload).toEqual({ arrowId: 'arrow-1' })
    }
  })

  it('should route dblclick on topic to ui:beginEdit intent', () => {
    const container = document.createElement('div')
    const topic = document.createElement('mm-topic') as Topic
    topic.nodeObj = { id: 'node-2', topic: 'N2' } as NodeObj
    container.append(topic)

    const event = new MouseEvent('dblclick')
    Object.defineProperty(event, 'target', { value: topic })

    const mind = { container, editable: true } as MindMapInstance
    const result = routeDblClickToIntent(event, mind)

    expect(result.matched).toBe(true)
    if (result.matched) {
      expect(result.intent.name).toBe('ui:beginEdit')
      expect(result.intent.payload).toEqual({ nodeId: 'node-2' })
    }
  })

  it('should route wheel zoom to canvas:zoomIn intent', () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
      } as DOMRect)

    const event = new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: -100,
      clientX: 10,
      clientY: 20,
    })

    const mind = { container } as MindMapInstance
    const result = routeWheelToIntent(event, mind)

    expect(result.matched).toBe(true)
    if (result.matched) {
      expect(result.intent.name).toBe('canvas:zoomIn')
      expect(result.intent.payload).toEqual({ centerX: 10, centerY: 20 })
    }
  })
})

describe('MindMap Phase 2 - IntentDispatcher', () => {
  it('should dispatch node:toggleExpand to command with meta', () => {
    const toggleExpand = vi.fn().mockReturnValue({ ok: true, txId: 'tx-1' })
    const mind = {
      commands: {
        node: {
          toggleExpand,
        },
      },
    } as MindMapInstance

    const dispatcher = new IntentDispatcher(mind)
    const intent = createIntent('node:toggleExpand', { nodeId: 'n1' }, 'click')
    const result = dispatcher.dispatch(intent)

    expect(result.handled).toBe(true)
    expect(toggleExpand).toHaveBeenCalledTimes(1)
    expect(toggleExpand.mock.calls[0][0]).toEqual({ nodeId: 'n1' })
    expect(toggleExpand.mock.calls[0][1]).toMatchObject({
      source: 'mouse',
      traceId: intent.meta.traceId,
    })
  })
})
