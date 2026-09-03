import type {
  MessageCatalogContribution,
  MessageParams,
} from '@app/localization';

export type SlidesToolCardMessageKey =
  | 'slides.tool.title.inspect'
  | 'slides.tool.title.inspectNamed'
  | 'slides.tool.title.export'
  | 'slides.tool.title.exportNamed'
  | 'slides.tool.compact.plan'
  | 'slides.tool.compact.inspect'
  | 'slides.tool.compact.export'
  | 'slides.plan.heading'
  | 'slides.plan.status.approved'
  | 'slides.plan.status.modified'
  | 'slides.plan.label.designConcept'
  | 'slides.plan.label.composition'
  | 'slides.plan.label.visualSignature'
  | 'slides.plan.aria.presentationTitle'
  | 'slides.plan.placeholder.audience'
  | 'slides.plan.aria.audience'
  | 'slides.plan.pageCount'
  | 'slides.plan.aria.visualDirection'
  | 'slides.plan.aria.pageOutline'
  | 'slides.plan.aria.pageActions'
  | 'slides.plan.aria.pageTitle'
  | 'slides.plan.aria.pageContent'
  | 'slides.plan.placeholder.pageTitle'
  | 'slides.plan.placeholder.pageContent'
  | 'slides.plan.action.addPage'
  | 'slides.plan.menu.insertBefore'
  | 'slides.plan.menu.insertAfter'
  | 'slides.plan.menu.moveUp'
  | 'slides.plan.menu.moveDown'
  | 'slides.plan.menu.delete'
  | 'slides.plan.notice.pageDeleted'
  | 'slides.plan.action.undo'
  | 'slides.plan.placeholder.notes'
  | 'slides.plan.aria.notes'
  | 'slides.plan.action.submitChanges'
  | 'slides.plan.action.approveAndContinue'
  | 'slides.plan.loading'
  | 'slides.plan.empty'
  | 'slides.plan.validation.title'
  | 'slides.plan.validation.visualDirection'
  | 'slides.plan.validation.pages'
  | 'slides.plan.error.submitFailed';

export type SlidesToolCardMessageResolver = (
  key: SlidesToolCardMessageKey,
  params?: MessageParams,
) => string;

export const SLIDES_TOOL_CARD_MESSAGE_FALLBACKS = {
  'slides.tool.title.inspect': '检查演示文稿',
  'slides.tool.title.inspectNamed': '检查演示文稿 · {title}',
  'slides.tool.title.export': '导出 PPTX',
  'slides.tool.title.exportNamed': '导出 PPTX · {fileName}',
  'slides.tool.compact.plan': '规划演示文稿',
  'slides.tool.compact.inspect': '检查演示文稿',
  'slides.tool.compact.export': '导出演示文稿',
  'slides.plan.heading': '演示文稿大纲',
  'slides.plan.status.approved': '已批准，Agent 继续执行。',
  'slides.plan.status.modified': '已提交修改，Linnya 将重新生成大纲。',
  'slides.plan.label.designConcept': '设计理念',
  'slides.plan.label.composition': '构图与节奏',
  'slides.plan.label.visualSignature': '视觉记忆点',
  'slides.plan.aria.presentationTitle': '演示文稿标题',
  'slides.plan.placeholder.audience': '补充目标受众',
  'slides.plan.aria.audience': '目标受众',
  'slides.plan.pageCount': '共 {count} 页',
  'slides.plan.aria.visualDirection': '整稿视觉方向',
  'slides.plan.aria.pageOutline': '演示文稿页面大纲',
  'slides.plan.aria.pageActions': '拖动或打开第 {number} 页操作菜单',
  'slides.plan.aria.pageTitle': '第 {number} 页标题',
  'slides.plan.aria.pageContent': '第 {number} 页主要内容',
  'slides.plan.placeholder.pageTitle': '页面标题',
  'slides.plan.placeholder.pageContent': '主要内容',
  'slides.plan.action.addPage': '新增页面',
  'slides.plan.menu.insertBefore': '在上方新增',
  'slides.plan.menu.insertAfter': '在下方新增',
  'slides.plan.menu.moveUp': '上移',
  'slides.plan.menu.moveDown': '下移',
  'slides.plan.menu.delete': '删除',
  'slides.plan.notice.pageDeleted': '已删除第 {number} 页',
  'slides.plan.action.undo': '撤销',
  'slides.plan.placeholder.notes': '补充对整体大纲的修改要求（可选）',
  'slides.plan.aria.notes': '整体修改备注',
  'slides.plan.action.submitChanges': '提交修改',
  'slides.plan.action.approveAndContinue': '批准并继续',
  'slides.plan.loading': '正在创建大纲...',
  'slides.plan.empty': '暂无可用的大纲数据',
  'slides.plan.validation.title': '请补全演示文稿标题。',
  'slides.plan.validation.visualDirection': '请补全设计理念、构图与节奏和视觉记忆点。',
  'slides.plan.validation.pages': '请补全所有页面的标题和主要内容。',
  'slides.plan.error.submitFailed': '提交大纲失败，请重试。',
} as const satisfies Readonly<Record<SlidesToolCardMessageKey, string>>;

export const SLIDES_TOOL_CARD_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'slides-tool-cards',
  catalogs: {
    'zh-CN': SLIDES_TOOL_CARD_MESSAGE_FALLBACKS,
    'en-US': {
      'slides.tool.title.inspect': 'Inspect presentation',
      'slides.tool.title.inspectNamed': 'Inspect presentation · {title}',
      'slides.tool.title.export': 'Export PPTX',
      'slides.tool.title.exportNamed': 'Export PPTX · {fileName}',
      'slides.tool.compact.plan': 'Plan presentation',
      'slides.tool.compact.inspect': 'Inspect presentation',
      'slides.tool.compact.export': 'Export presentation',
      'slides.plan.heading': 'Presentation Outline',
      'slides.plan.status.approved': 'Approved. The Agent will continue.',
      'slides.plan.status.modified': 'Changes submitted. Linnya will regenerate the outline.',
      'slides.plan.label.designConcept': 'Concept',
      'slides.plan.label.composition': 'Composition',
      'slides.plan.label.visualSignature': 'Signature',
      'slides.plan.aria.presentationTitle': 'Presentation title',
      'slides.plan.placeholder.audience': 'Add target audience',
      'slides.plan.aria.audience': 'Target audience',
      'slides.plan.pageCount': 'Slides: {count}',
      'slides.plan.aria.visualDirection': 'Overall visual direction',
      'slides.plan.aria.pageOutline': 'Presentation slide outline',
      'slides.plan.aria.pageActions': 'Drag or open actions for slide {number}',
      'slides.plan.aria.pageTitle': 'Title for slide {number}',
      'slides.plan.aria.pageContent': 'Main content for slide {number}',
      'slides.plan.placeholder.pageTitle': 'Slide title',
      'slides.plan.placeholder.pageContent': 'Main content',
      'slides.plan.action.addPage': 'Add slide',
      'slides.plan.menu.insertBefore': 'Insert above',
      'slides.plan.menu.insertAfter': 'Insert below',
      'slides.plan.menu.moveUp': 'Move up',
      'slides.plan.menu.moveDown': 'Move down',
      'slides.plan.menu.delete': 'Delete',
      'slides.plan.notice.pageDeleted': 'Deleted slide {number}',
      'slides.plan.action.undo': 'Undo',
      'slides.plan.placeholder.notes': 'Add overall outline revision notes (optional)',
      'slides.plan.aria.notes': 'Overall revision notes',
      'slides.plan.action.submitChanges': 'Submit changes',
      'slides.plan.action.approveAndContinue': 'Approve and continue',
      'slides.plan.loading': 'Creating outline...',
      'slides.plan.empty': 'No outline available',
      'slides.plan.validation.title': 'Complete the presentation title.',
      'slides.plan.validation.visualDirection': 'Complete the design rationale, composition and pacing, and visual signature.',
      'slides.plan.validation.pages': 'Complete the title and main content for every slide.',
      'slides.plan.error.submitFailed': 'Unable to submit the outline. Please try again.',
    },
  },
};
