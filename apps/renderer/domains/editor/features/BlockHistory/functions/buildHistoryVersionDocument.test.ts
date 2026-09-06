import { describe, expect, it } from 'vitest'

import { buildHistoryVersionDocument } from './buildHistoryVersionDocument'

describe('buildHistoryVersionDocument', () => {
  it('将 rootBlock 快照包装成完整 doc', () => {
    expect(buildHistoryVersionDocument(JSON.stringify({
      type: 'rootBlock',
      attrs: { id: 'root-1' },
      content: [],
    }))).toEqual({
      type: 'doc',
      content: [{
        type: 'rootBlock',
        attrs: { id: 'root-1' },
        content: [],
      }],
    })
  })

  it('保留已经包装的完整 doc', () => {
    const document = {
      type: 'doc',
      content: [{ type: 'rootBlock', attrs: { id: 'root-1' }, content: [] }],
    }

    expect(buildHistoryVersionDocument(JSON.stringify(document))).toEqual(document)
  })

  it('拒绝坏 JSON 和没有 type 的节点', () => {
    expect(() => buildHistoryVersionDocument('{')).toThrow('不是有效 JSON')
    expect(() => buildHistoryVersionDocument(JSON.stringify({ content: [] })))
      .toThrow('必须是带 type 的 ProseMirror JSON 节点')
  })
})
