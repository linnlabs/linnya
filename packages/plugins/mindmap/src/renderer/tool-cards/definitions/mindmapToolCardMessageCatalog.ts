import type { MessageCatalogContribution } from '@app/localization'

export type MindmapToolCardMessageKey =
  | 'mindmap.tool.title.document'
  | 'mindmap.tool.tag.createNode'
  | 'mindmap.tool.compact.createNode'

export const MINDMAP_TOOL_CARD_MESSAGE_FALLBACKS = {
  'mindmap.tool.title.document': '{document}',
  'mindmap.tool.tag.createNode': '新增节点',
  'mindmap.tool.compact.createNode': '创建思维导图节点',
} as const satisfies Readonly<Record<MindmapToolCardMessageKey, string>>

export const MINDMAP_TOOL_CARD_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'mindmap-tool-cards',
  catalogs: {
    'zh-CN': MINDMAP_TOOL_CARD_MESSAGE_FALLBACKS,
    'en-US': {
      'mindmap.tool.title.document': '{document}',
      'mindmap.tool.tag.createNode': 'Create nodes',
      'mindmap.tool.compact.createNode': 'Create mindmap node',
    },
  },
}
