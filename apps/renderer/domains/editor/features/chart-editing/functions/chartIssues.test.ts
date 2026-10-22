import { describe, expect, it } from 'vitest'
import { MarkdownChartSpecInvalidError, type MarkdownChartDiagnostic } from '@app/schemas'
import { listChartIssues } from './chartIssues'

const diagnostic = (path: string, extra: Partial<MarkdownChartDiagnostic> = {}): MarkdownChartDiagnostic => ({
  code: 'invalid_shape',
  path,
  message: `bad ${path}`,
  ...extra,
})

describe('listChartIssues', () => {
  it('每条问题带图表序号、字段路径和说明', () => {
    const error = new MarkdownChartSpecInvalidError([diagnostic('series[0].values')], { chartOrdinal: 2 })

    expect(listChartIssues(error)).toEqual(['#2 series[0].values: bad series[0].values'])
  })

  it('JSON 语法错误附带行列位置', () => {
    const error = new MarkdownChartSpecInvalidError(
      [diagnostic('$', { code: 'invalid_json', location: { line: 3, column: 7 } })],
      { chartOrdinal: 1 },
    )

    expect(listChartIssues(error)[0]).toBe('#1 $ (3:7): bad $')
  })

  it('问题很多时只列前几条并给出剩余数量', () => {
    const many = Array.from({ length: 10 }, (_, index) => diagnostic(`series[${index}]`))
    const error = new MarkdownChartSpecInvalidError(many, {})

    const issues = listChartIssues(error)
    expect(issues).toHaveLength(7)
    expect(issues[0]).toBe('series[0]: bad series[0]')
    expect(issues[6]).toBe('+4')
  })
})
