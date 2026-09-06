import { describe, expect, it } from 'vitest'

import { validateBlockHistoryContentJson } from './validateBlockHistoryContentJson'

const validRootBlock = {
  type: 'rootBlock',
  attrs: { id: 'root-1' },
  content: [{
    type: 'baseBlock',
    attrs: { id: 'block-1' },
    content: [],
  }],
}

describe('validateBlockHistoryContentJson', () => {
  it('校验 rootBlock identity 并返回规范化快照', () => {
    const normalized = validateBlockHistoryContentJson(JSON.stringify(validRootBlock), 'root-1')

    expect(JSON.parse(normalized)).toMatchObject({
      type: 'rootBlock',
      attrs: {
        id: 'root-1',
        annotations: [],
        isDragging: false,
      },
      content: [{
        attrs: {
          id: 'block-1',
          blockType: 'base',
          textAlign: 'left',
        },
      }],
    })
  })

  it('拒绝非法 JSON、错误节点、未知属性和错误 block identity', () => {
    expect(() => validateBlockHistoryContentJson('{', 'root-1'))
      .toThrow('不是有效 JSON')
    expect(() => validateBlockHistoryContentJson(JSON.stringify({ type: 'doc', content: [] }), 'root-1'))
      .toThrow('必须是 rootBlock JSON 节点')
    expect(() => validateBlockHistoryContentJson(JSON.stringify({
      ...validRootBlock,
      attrs: { id: 'root-1', unknown: true },
    }), 'root-1')).toThrow('未知属性 "unknown"')
    expect(() => validateBlockHistoryContentJson(JSON.stringify(validRootBlock), 'root-2'))
      .toThrow('与目标块不一致')
  })
})
