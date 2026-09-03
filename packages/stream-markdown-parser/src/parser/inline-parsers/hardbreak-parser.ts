import type { HardBreakNode } from '../../types'

export function parseHardbreakToken(): HardBreakNode {
  return {
    type: 'hardbreak',
    raw: '\\\n',
  }
}
