import { describe, expect, it } from 'vitest'

import { extractKnowledgeBaseErrorMessage } from './extractKnowledgeBaseErrorMessage.js'

describe('extractKnowledgeBaseErrorMessage', () => {
  it('透出后端返回的 embedding 出身不一致错误消息', () => {
    const message = '知识库 kb-1 的索引用 embedding-a 构建，当前全局嵌入模型是 embedding-b。请清空并重新导入该知识库后再搜索。'

    expect(extractKnowledgeBaseErrorMessage({
      response: {
        data: {
          error: message,
        },
      },
    })).toBe(message)
  })

  it('优先使用 detail/message/error 中第一个明确文案', () => {
    expect(extractKnowledgeBaseErrorMessage({
      response: {
        data: {
          detail: '详细原因',
          message: '普通消息',
          error: '错误消息',
        },
      },
    })).toBe('详细原因')
  })
})
