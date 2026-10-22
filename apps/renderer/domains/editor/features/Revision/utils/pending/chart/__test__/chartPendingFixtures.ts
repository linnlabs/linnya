import { EditorState } from '@tiptap/pm/state'
import { admitMarkdownChartSpec, type MarkdownChartSpec } from '@app/schemas'
import { workspaceMarkdownSchemaLite as schema } from 'src/domains/markdown'
import type { ParsedPendingRevision } from '../../pendingRevisionTypes'

export function chartSpec(value = 1, title?: string): MarkdownChartSpec {
  const admission = admitMarkdownChartSpec({
    chartType: 'bar',
    ...(title ? { title } : {}),
    categories: ['A', 'B'],
    series: [{ name: 'S', values: [value, 2] }],
  })
  if (!admission.ok) throw new Error('fixture invalid')
  return admission.spec
}

export function chartFenceEvent(spec: MarkdownChartSpec | string = chartSpec()) {
  return {
    block_type: 'CodeBlock',
    language: 'linnya-chart',
    raw_content_fallback: typeof spec === 'string' ? spec : JSON.stringify(spec),
  }
}

export function paragraphEvent(text: string) {
  return { block_type: 'BaseBlock', structured_content: [{ type: 'text', text, marks: [] }], raw_content_fallback: text }
}

const nodes = schema.nodes

export const paragraphRoot = (rootId: string, text = '') =>
  nodes['rootBlock']!.create({ id: rootId }, nodes['baseBlock']!.create({ id: `${rootId}-content` }, text ? schema.text(text) : undefined))

export const chartRoot = (rootId: string, spec: MarkdownChartSpec = chartSpec()) =>
  nodes['rootBlock']!.create({ id: rootId }, nodes['chartBlock']!.create({ id: `${rootId}-chart`, spec }))

export function stateOf(...roots: ReturnType<typeof paragraphRoot>[]) {
  return EditorState.create({ doc: nodes['doc']!.create(null, roots) })
}

export function pending(overrides: Partial<ParsedPendingRevision> & Pick<ParsedPendingRevision, 'id' | 'blockId'>): ParsedPendingRevision {
  return {
    conversationId: '',
    operation: 'update',
    originalMarkdown: null,
    newMarkdown: null,
    shouldRetry: false,
    ...overrides,
  }
}
