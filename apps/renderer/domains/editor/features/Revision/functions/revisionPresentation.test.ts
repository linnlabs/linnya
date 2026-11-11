import { describe, expect, it } from 'vitest'
import type { EditorMessageResolver } from '../../../definitions/editorMessages'
import {
  formatRevisionBlockCount,
  formatRevisionIndicatorTitle,
  formatRevisionStatsParts,
  resolveRevisionMarkAcceptTitle,
  resolveRevisionMarkRejectTitle,
} from './revisionPresentation'

const testMessage: EditorMessageResolver = (key, params) => {
  const messages: Partial<Record<Parameters<EditorMessageResolver>[0], string>> = {
    'editor.revision.global.blockCount': '{count} blocks',
    'editor.revision.indicator.statsSeparator': ', ',
    'editor.revision.indicator.insertStat': '{count} additions',
    'editor.revision.indicator.deleteStat': '{count} deletions',
    'editor.revision.indicator.pendingTitle': 'Pending revisions',
    'editor.revision.indicator.pendingTitleWithStats': 'Pending revisions: {stats}',
    'editor.revision.indicator.pendingTitleDeferred': 'Pending revisions: detailed diff not projected yet',
    'editor.revision.mark.acceptInsert': 'Accept inserted content',
    'editor.revision.mark.acceptDelete': 'Accept deletion',
    'editor.revision.mark.rejectInsert': 'Reject inserted content',
    'editor.revision.mark.rejectDelete': 'Reject deletion',
  }

  const raw = messages[key] ?? key
  if (!params) return raw

  return Object.entries(params).reduce((text, [paramKey, value]) => {
    return text.replace(`{${paramKey}}`, String(value))
  }, raw)
}

describe('revisionPresentation', () => {
  it('格式化文档级块数量和修订统计', () => {
    expect(formatRevisionBlockCount(3, testMessage)).toBe('3 blocks')
    expect(formatRevisionStatsParts({ insertCount: 2, deleteCount: 1 }, testMessage)).toEqual([
      '2 additions',
      '1 deletions',
    ])
  })

  it('根据投影完成情况生成待处理指示器标题', () => {
    expect(formatRevisionIndicatorTitle({
      insertCount: 2,
      deleteCount: 1,
      hasDetailedStats: true,
    }, testMessage)).toBe('Pending revisions: 2 additions, 1 deletions')

    expect(formatRevisionIndicatorTitle({
      insertCount: 0,
      deleteCount: 0,
      hasDetailedStats: false,
    }, testMessage)).toBe('Pending revisions: detailed diff not projected yet')
  })

  it('解析单条 mark 操作标题', () => {
    expect(resolveRevisionMarkAcceptTitle('insert', testMessage)).toBe('Accept inserted content')
    expect(resolveRevisionMarkAcceptTitle('delete', testMessage)).toBe('Accept deletion')
    expect(resolveRevisionMarkRejectTitle('insert', testMessage)).toBe('Reject inserted content')
    expect(resolveRevisionMarkRejectTitle('delete', testMessage)).toBe('Reject deletion')
  })
})
