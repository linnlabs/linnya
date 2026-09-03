import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';

export const slidesConsultingReferenceCase = {
  id: 'slides_consulting_reference_v1',
  revision: 2,
  name: '咨询风格 Slides：参考图复现设计语言',
  description: '用固定主题和页数，验证 Agent 能否理解咨询/投研参考图并生成可编辑、高质量 Slides。',
  tags: ['slides', 'consulting', 'visual-reference', 'chinese'],
  agentId: 'slides_agent',
  reasoningEffort: 'high',
  timeoutMs: 60 * 60 * 1000,
  promptTemplate: `请制作一份 10 页、16:9 的中文咨询/投研风格 PPT，主题为《2026 年中国人形机器人核心零部件行业投资机会》。

视觉参考图片位于：{{reference_image}}

请先读取该图片，只学习它的设计语言与信息组织方式：结论式标题、深蓝/白/少量金色的克制配色、严格网格、产业链卡片、竞争矩阵、重点高亮、页脚结论与来源标注。不要复制图片中的光源资本名称、Logo、公司名称、原文数据或具体文案，也不要把参考图直接铺成页面背景。

成品必须恰好 10 页，至少覆盖：封面、执行摘要、行业驱动、市场空间、产业链/价值链、核心零部件拆解、竞争格局、代表企业比较、风险与催化剂、投资结论。需要事实或数据时使用公开可信来源并在相应页面标注；不能确认的数据不要编造。保持专业、紧凑、易读，优先使用 Slides 原生可编辑元素；图表与示意图应服务于结论，不要堆装饰。完成后进行编译与预览质量检查，并修复发现的问题。`,
  inputs: [{
    key: 'reference_image',
    label: '咨询风格参考图',
    kind: 'absolute_file',
    required: true,
  }],
  interaction: {
    awaitingUser: 'approve',
    maxResponses: 3,
  },
  artifactExpectation: '一个恰好 10 页、可在 Linnya 前端查看并可导出为 PPTX 的 Slides 文档。',
  humanReview: [
    { id: 'structure', label: '叙事与结构', guidance: '结论先行，十页逻辑连续，不是十张孤立海报。' },
    { id: 'hierarchy', label: '信息层级', guidance: '标题、分区、重点和来源层级清楚，能快速扫读。' },
    { id: 'grid', label: '网格与对齐', guidance: '卡片、矩阵、边距和页脚使用一致网格，无明显漂移。' },
    { id: 'readability', label: '密度与可读性', guidance: '保持咨询报告的信息密度，同时正文不过小、不拥挤。' },
    { id: 'consistency', label: '视觉一致性', guidance: '深蓝/白/金配色、字体、线条和组件语言跨页一致。' },
    { id: 'visuals', label: '图表与示意图', guidance: '图表、矩阵或 SVG 示意图准确表达结论，不用形状堆砌复杂插画。' },
    { id: 'evidence', label: '事实与来源', guidance: '关键数字可追溯，不编造，不复制参考图的具体业务内容。' },
    { id: 'fidelity', label: '预览与导出', guidance: 'Linnya 预览无编译错误；抽查 PPTX 导出与预览接近。' },
  ],
} satisfies BenchmarkCaseDefinition;
