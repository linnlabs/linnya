import { describe, expect, it } from 'vitest'

import { convertKbResultToCitationAttrs } from './knowledgeBaseCitationAdapter'

describe('knowledgeBaseCitationAdapter', () => {
  it('将搜索结果的 Knowledge 精确块锚点写入 CitationNode attrs', () => {
    const attrs = convertKbResultToCitationAttrs(
      {
        kbId: 'kb-1',
        kbName: '知识库',
        docId: 'doc-1',
        docTitle: '文献标题',
        blockId: 'block-1',
        score: 0.9,
        text: '文献原文',
        snippet: '文献原文',
      },
      { unknownDocumentTitle: '未知文档' }
    )

    expect(attrs).toMatchObject({
      sourceType: 'knowledge_base',
      sourceId: 'doc-1',
      kbId: 'kb-1',
      blockId: 'block-1',
      title: '文献标题',
      snippet: '文献原文',
    })
  })

  it('缺少 blockId 时拒绝创建只有文档级身份的 Knowledge 引用', () => {
    expect(() =>
      convertKbResultToCitationAttrs({
        kbId: 'kb-1',
        kbName: '知识库',
        docId: 'doc-1',
        docTitle: '文献标题',
        score: 0.9,
        text: '文献原文',
        snippet: '文献原文',
      })
    ).toThrow('Knowledge 引用缺少精确 blockId')
  })
})
