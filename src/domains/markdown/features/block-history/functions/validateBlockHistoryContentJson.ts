import {
  parseMarkdownDocJson,
  validateMarkdownDocJson,
} from '../../normalization'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 校验并规范化 markdown_block_versions 中的 rootBlock 快照。 */
export function validateBlockHistoryContentJson(
  contentJson: string,
  targetBlockId: string,
): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(contentJson)
  } catch {
    throw new Error('块历史 content_json 不是有效 JSON')
  }

  if (!isRecord(parsed) || parsed.type !== 'rootBlock') {
    throw new Error('块历史 content_json 必须是 rootBlock JSON 节点')
  }

  const candidateDocument: unknown = {
    type: 'doc',
    content: [parsed],
  }
  const document = validateMarkdownDocJson(parseMarkdownDocJson(candidateDocument))
  const rootBlock = document.content[0]
  const rootBlockId = isRecord(rootBlock.attrs) ? rootBlock.attrs.id : undefined

  if (rootBlockId !== targetBlockId) {
    throw new Error(
      `块历史 rootBlock identity 与目标块不一致: expected=${targetBlockId}, actual=${String(rootBlockId)}`,
    )
  }

  return JSON.stringify(rootBlock)
}
