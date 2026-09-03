import { describe, expect, it, vi } from 'vitest'
import type { EditorMessageResolver } from '../../../definitions/editorMessages'
import {
  formatRevisionBlockCount,
  formatRevisionIndicatorTitle,
  formatRevisionStatsParts,
  formatRevisionTimeLabel,
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
    'editor.revision.indicator.appliedTitle': 'Accepted revisions: {stats}',
    'editor.revision.indicator.discardedTitle': 'Rejected revisions: {stats}',
    'editor.revision.mark.acceptInsert': 'Accept inserted content',
    'editor.revision.mark.acceptDelete': 'Accept deletion',
    'editor.revision.mark.rejectInsert': 'Reject inserted content',
    'editor.revision.mark.rejectDelete': 'Reject deletion',
    'editor.revision.time.yesterday': 'Yesterday',
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

  it('根据状态生成指示器标题', () => {
    expect(formatRevisionIndicatorTitle({
      status: 'pending',
      insertCount: 2,
      deleteCount: 1,
      hasDetailedStats: true,
    }, testMessage)).toBe('Pending revisions: 2 additions, 1 deletions')

    expect(formatRevisionIndicatorTitle({
      status: 'pending',
      insertCount: 0,
      deleteCount: 0,
      hasDetailedStats: false,
    }, testMessage)).toBe('Pending revisions: detailed diff not projected yet')

    expect(formatRevisionIndicatorTitle({
      status: 'applied',
      insertCount: 2,
      deleteCount: 0,
      hasDetailedStats: true,
    }, testMessage)).toBe('Accepted revisions: 2 additions')
  })

  it('解析单条 mark 操作标题', () => {
    expect(resolveRevisionMarkAcceptTitle('insert', testMessage)).toBe('Accept inserted content')
    expect(resolveRevisionMarkAcceptTitle('delete', testMessage)).toBe('Accept deletion')
    expect(resolveRevisionMarkRejectTitle('insert', testMessage)).toBe('Reject inserted content')
    expect(resolveRevisionMarkRejectTitle('delete', testMessage)).toBe('Reject deletion')
  })

  it('格式化 Revision 自己的相对时间标签', () => {
    vi.setSystemTime(new Date('2026-06-22T10:30:40'))

    expect(formatRevisionTimeLabel(new Date('2026-06-22T09:01:02').getTime(), testMessage)).toBe('09:01:02')
    expect(formatRevisionTimeLabel(new Date('2026-06-21T09:01:02').getTime(), testMessage)).toBe('Yesterday')
    expect(formatRevisionTimeLabel(undefined, testMessage)).toBe('')

    vi.useRealTimers()
  })
})
