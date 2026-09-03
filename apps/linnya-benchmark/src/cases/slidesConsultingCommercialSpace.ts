import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';

export const slidesConsultingCommercialSpaceCase = {
  id: 'slides_consulting_commercial_space_v1',
  revision: 1,
  name: '咨询风格 Slides：中国商业航天与卫星互联网',
  description: '验证 Agent 能否完成商业航天资料研究，并形成十页、结论先行的高密度咨询 Slides。',
  tags: ['slides', 'consulting', 'high-density', 'web-research', 'chinese'],
  agentId: 'slides_agent',
  reasoningEffort: 'high',
  timeoutMs: 90 * 60 * 1000,
  promptTemplate: `请制作一份恰好 10 页、16:9 的中文咨询/投研风格 PPT，主题为《2026 年中国商业航天与卫星互联网产业链投资机会》。这是一次真实咨询交付测试，不是概念海报或演讲提纲。

视觉参考图片位于：{{reference_image}}

请先读取参考图片，只学习它的设计语言和信息组织方式：结论式标题、深蓝/白/少量金色的克制配色、严格网格、同页多模块、产业链拆解、竞争矩阵、重点高亮、页尾结论与来源。不要复制图片中的光源资本名称、Logo、公司名称、原文数据或具体文案，也不要把参考图直接铺成页面背景。

请使用公开可信资料完成必要研究，数据口径尽量截至 2026 年 8 月。优先使用政府、监管机构、上市公司公告/年报、国际组织和行业协会等一手来源；关键数字必须在相应页面标明来源与年份，无法确认的数据不要编造。成品必须恰好 10 页，形成连续论证链，并至少覆盖：封面、执行摘要、政策与需求驱动、市场空间与测算口径、卫星制造产业链、火箭发射与地面设施、卫星运营与应用、竞争格局及代表企业、催化剂与风险、投资结论与跟踪指标。

除封面外，每页都要有明确的结论标题、2—4 个相互支撑的信息模块和页尾 takeaway/source；正文页通常应包含 8—15 个可独立读取的事实、标签、指标或判断，并至少使用一种真正承载信息的结构，例如数据图表、对比表、矩阵、产业链、情景拆解或时间轴。不要用一个大标题加三条空泛 bullet 填满一页，也不要为了留白牺牲论证所需的信息。保持可读性：主要正文原则上不小于 9pt，重要结论和关键数字应明显高于正文层级。

优先使用 Slides 原生可编辑元素；复杂关系图可以使用不含文字的 SVG 图形并叠加原生 Text。避免用大量基础形状拼复杂插画。完成后必须执行编译、整份 inspect 和代表页面的预览检查，修复文字竖排、溢出、遮挡、错位、空洞页面、来源不可读及跨页样式漂移后再交付。`,
  inputs: [{
    key: 'reference_image',
    label: '高密度咨询风格参考图',
    kind: 'absolute_file',
    required: true,
  }],
  interaction: {
    awaitingUser: 'approve',
    maxResponses: 4,
  },
  artifactExpectation: '一个恰好 10 页、完成公开资料研究、可在 Linnya 查看并可导出为 PPTX 的高信息密度 Slides 文档。',
  humanReview: [
    { id: 'argument', label: '投资论证链', guidance: '问题定义、证据、判断和投资含义前后相接，不是页面清单。' },
    { id: 'density', label: '信息密度', guidance: '正文页具有多个有效信息模块和足够证据，不是大留白海报。' },
    { id: 'evidence', label: '事实与来源', guidance: '关键数字有可靠来源与年份，口径和假设可理解，没有伪造或错误引用。' },
    { id: 'exhibits', label: '咨询图表', guidance: '图表、矩阵、产业链、情景分析和表格真正支撑判断。' },
    { id: 'grid', label: '网格与对齐', guidance: '多模块页面仍保持统一边距、分栏、对齐和页脚。' },
    { id: 'readability', label: '可读性', guidance: '无文字竖排、溢出、过小正文或不可读来源。' },
    { id: 'consistency', label: '视觉一致性', guidance: '配色、字体、线条、卡片与强调语言跨页一致。' },
    { id: 'fidelity', label: '预览与导出', guidance: 'Linnya 预览无编译错误；抽查 PPTX 导出与预览接近。' },
  ],
} satisfies BenchmarkCaseDefinition;
