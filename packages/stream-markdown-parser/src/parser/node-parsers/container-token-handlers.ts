import type { AdmonitionNode, MarkdownToken, ParseOptions } from '../../types'
import { parseAdmonition } from './admonition-parser'
import { parseContainer } from './container-parser'

const CONTAINER_REGEX
  = /^::: ?(warning|info|note|tip|danger|caution|error) ?(.*)$/

function handleContainerOpen(
  tokens: MarkdownToken[],
  index: number,
  options?: ParseOptions,
): [AdmonitionNode, number] | null {
  const token = tokens[index]
  if (token.type !== 'container_open')
    return null
  const match = CONTAINER_REGEX.exec(String(token.info ?? ''))
  if (!match)
    return null
  return parseAdmonition(tokens, index, match, options)
}

export const containerTokenHandlers = {
  parseContainer: (
    tokens: MarkdownToken[],
    index: number,
    options?: ParseOptions,
  ) => parseContainer(tokens, index, options),
  matchAdmonition: handleContainerOpen,
}
