import type { MessageCatalogContribution } from '@app/localization';

export type MindmapToolCardMessageKey =
  | 'mindmap.tool.title.document'
  | 'mindmap.tool.tag.update'
  | 'mindmap.tool.tag.attachEvidence'
  | 'mindmap.tool.tag.createNode'
  | 'mindmap.tool.compact.tagNode'
  | 'mindmap.tool.compact.attachEvidence'
  | 'mindmap.tool.compact.createNode'
  | 'mindmap.tool.compact.decompose'
  | 'mindmap.tool.compact.propose'
  | 'mindmap.tool.compact.validate'
  | 'mindmap.tool.compact.parallel';

export const MINDMAP_TOOL_CARD_MESSAGE_FALLBACKS = {
  'mindmap.tool.title.document': '{document}',
  'mindmap.tool.tag.update': '更新标签',
  'mindmap.tool.tag.attachEvidence': '挂载证据',
  'mindmap.tool.tag.createNode': '新增节点',
  'mindmap.tool.compact.tagNode': '更新思维导图标签',
  'mindmap.tool.compact.attachEvidence': '挂载思维导图证据',
  'mindmap.tool.compact.createNode': '创建思维导图节点',
  'mindmap.tool.compact.decompose': '拆解研究问题',
  'mindmap.tool.compact.propose': '提出候选假设',
  'mindmap.tool.compact.validate': '验证研究假设',
  'mindmap.tool.compact.parallel': '并行分析思维导图',
} as const satisfies Readonly<Record<MindmapToolCardMessageKey, string>>;

export const MINDMAP_TOOL_CARD_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'mindmap-tool-cards',
  catalogs: {
    'zh-CN': MINDMAP_TOOL_CARD_MESSAGE_FALLBACKS,
    'en-US': {
      'mindmap.tool.title.document': '{document}',
      'mindmap.tool.tag.update': 'Update tags',
      'mindmap.tool.tag.attachEvidence': 'Attach evidence',
      'mindmap.tool.tag.createNode': 'Create nodes',
      'mindmap.tool.compact.tagNode': 'Update mindmap tags',
      'mindmap.tool.compact.attachEvidence': 'Attach mindmap evidence',
      'mindmap.tool.compact.createNode': 'Create mindmap node',
      'mindmap.tool.compact.decompose': 'Decompose research question',
      'mindmap.tool.compact.propose': 'Propose hypotheses',
      'mindmap.tool.compact.validate': 'Validate hypothesis',
      'mindmap.tool.compact.parallel': 'Analyze mindmap in parallel',
    },
  },
};
