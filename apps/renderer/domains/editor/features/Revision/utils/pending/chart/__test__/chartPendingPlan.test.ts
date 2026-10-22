import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ parseMarkdownToBlockEvents: vi.fn() }))

vi.mock('../../../../../../services/markdownRuntime', async () => {
  const actual = await vi.importActual<typeof import('../../../../../../services/markdownRuntime')>(
    '../../../../../../services/markdownRuntime',
  )
  return { ...actual, parseMarkdownToBlockEvents: mocks.parseMarkdownToBlockEvents }
})

import { partitionChartPendingRevisions, planChartPendingRevision } from '../chartPendingPlan'
import { chartFenceEvent, chartRoot, chartSpec, paragraphEvent, paragraphRoot, pending, stateOf } from './chartPendingFixtures'

const fence = '```linnya-chart\n{}\n```'

describe('planChartPendingRevision', () => {
  beforeEach(() => mocks.parseMarkdownToBlockEvents.mockReset())

  it('恰好一个图表围栏的 insert/update 是 put，规格经统一准入', async () => {
    mocks.parseMarkdownToBlockEvents.mockResolvedValue([chartFenceEvent(chartSpec(3, '销量'))])
    const doc = stateOf(paragraphRoot('r1', 'x')).doc

    const plan = await planChartPendingRevision(doc, pending({ id: 'p1', blockId: 'r1', operation: 'update', newMarkdown: fence }))

    expect(plan).toMatchObject({ kind: 'put', spec: { chartType: 'bar', title: '销量' } })
  })

  it('不含图表语言的 Markdown 不会被解析，直接交回通用路径', async () => {
    const doc = stateOf(paragraphRoot('r1', 'x')).doc

    expect(await planChartPendingRevision(doc, pending({ id: 'p1', blockId: 'r1', newMarkdown: '普通正文' }))).toBeNull()
    expect(mocks.parseMarkdownToBlockEvents).not.toHaveBeenCalled()
  })

  it('提到图表语言但不是图表围栏（或混有其他块）时交回通用路径', async () => {
    const doc = stateOf(paragraphRoot('r1', 'x')).doc
    mocks.parseMarkdownToBlockEvents.mockResolvedValue([paragraphEvent('说明 linnya-chart 的用法')])
    expect(await planChartPendingRevision(doc, pending({ id: 'p1', blockId: 'r1', newMarkdown: '说明 linnya-chart 的用法' }))).toBeNull()

    mocks.parseMarkdownToBlockEvents.mockResolvedValue([paragraphEvent('前文'), chartFenceEvent()])
    expect(await planChartPendingRevision(doc, pending({ id: 'p2', blockId: 'r1', newMarkdown: fence }))).toBeNull()
  })

  it('空白段落事件不影响单图表围栏的识别', async () => {
    mocks.parseMarkdownToBlockEvents.mockResolvedValue([paragraphEvent('  '), chartFenceEvent()])
    const doc = stateOf(paragraphRoot('r1')).doc

    const plan = await planChartPendingRevision(doc, pending({ id: 'p1', blockId: 'r1', operation: 'insert', newMarkdown: fence }))

    expect(plan?.kind).toBe('put')
  })

  it('无效围栏返回 invalid 和可读原因，不抛出', async () => {
    mocks.parseMarkdownToBlockEvents.mockResolvedValue([chartFenceEvent('{"chartType": "nope"}')])
    const doc = stateOf(paragraphRoot('r1')).doc

    const plan = await planChartPendingRevision(doc, pending({ id: 'p1', blockId: 'r1', newMarkdown: fence }))

    expect(plan?.kind).toBe('invalid')
    expect(plan && 'reason' in plan ? plan.reason : '').toContain('Invalid linnya-chart fence')
  })

  it('delete：目标块当前是图表才走图表路径', async () => {
    const doc = stateOf(chartRoot('r-chart'), paragraphRoot('r-text', 'x')).doc

    expect(await planChartPendingRevision(doc, pending({ id: 'p1', blockId: 'r-chart', operation: 'delete' }))).toEqual({ kind: 'remove' })
    expect(await planChartPendingRevision(doc, pending({ id: 'p2', blockId: 'r-text', operation: 'delete' }))).toBeNull()
    expect(await planChartPendingRevision(doc, pending({ id: 'p3', blockId: 'missing', operation: 'delete' }))).toBeNull()
  })

  it('metadata 中显式的 operation 优先于 DTO 字段', async () => {
    const doc = stateOf(chartRoot('r-chart')).doc

    const plan = await planChartPendingRevision(doc, pending({
      id: 'p1', blockId: 'r-chart', operation: 'update', metadata: { operation: 'delete' },
    }))

    expect(plan).toEqual({ kind: 'remove' })
  })
})

describe('partitionChartPendingRevisions', () => {
  beforeEach(() => mocks.parseMarkdownToBlockEvents.mockReset())

  it('图表与其余 Pending 分开，各自保持原顺序', async () => {
    mocks.parseMarkdownToBlockEvents.mockResolvedValue([chartFenceEvent()])
    const doc = stateOf(paragraphRoot('r1', 'a'), paragraphRoot('r2', 'b'), chartRoot('r3')).doc
    const revisions = [
      pending({ id: 'a', blockId: 'r1', newMarkdown: '普通' }),
      pending({ id: 'b', blockId: 'r2', newMarkdown: fence }),
      pending({ id: 'c', blockId: 'r3', operation: 'delete' }),
      pending({ id: 'd', blockId: 'r1', newMarkdown: '另一个' }),
    ]

    const { chartItems, others } = await partitionChartPendingRevisions(doc, revisions)

    expect(chartItems.map(item => item.parsed.id)).toEqual(['b', 'c'])
    expect(chartItems.map(item => item.plan.kind)).toEqual(['put', 'remove'])
    expect(others.map(item => item.id)).toEqual(['a', 'd'])
  })
})
