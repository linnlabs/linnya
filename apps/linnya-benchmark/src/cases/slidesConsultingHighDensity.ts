import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';

export const slidesConsultingHighDensityCase = {
  id: 'slides_consulting_high_density_v1',
  revision: 1,
  name: '高信息密度咨询 Slides：AI 数据中心基础设施',
  description: '验证 Agent 能否完成真实资料研究，并把证据组织成高密度、结论先行、可编辑的咨询风格 Slides。',
  tags: ['slides', 'consulting', 'high-density', 'web-research', 'chinese'],
  agentId: 'slides_agent',
  reasoningEffort: 'high',
  timeoutMs: 90 * 60 * 1000,
  promptTemplate: `请制作一份恰好 12 页、16:9 的中文咨询风格 PPT，主题为《2026 年中国 AI 数据中心电力与液冷基础设施投资机会》。这是一次真实咨询交付测试，不是概念海报或演讲提纲。

视觉参考图片位于：{{reference_image}}

请先读取参考图片，只学习它的设计语言和信息组织方式：结论式标题、深蓝/白/少量金色的克制配色、严格网格、同页多模块、对比矩阵、产业链拆解、重点高亮、页尾结论与来源。不要复制图片中的光源资本名称、Logo、公司名称、原文数据或具体文案，也不要把参考图直接铺成页面背景。

请使用公开可信资料完成必要研究，数据口径尽量截至 2026 年 8 月。优先使用政府、监管机构、上市公司公告/年报、国际能源署、行业协会和其他一手来源；关键数字必须在相应页面标明来源与年份，无法确认的数字不要编造。最终文稿应形成连续的投资论证链，而不是 12 张彼此孤立的页面。

页面结构必须覆盖：
1. 封面；
2. 执行摘要：3—4 条核心判断及对应投资含义；
3. 市场边界：AI 数据中心供配电、备用电源、热管理与液冷的系统架构；
4. 需求驱动：算力、电力密度、能耗约束和政策变化；
5. 市场空间：给出口径、关键假设和基准/乐观/审慎情景；
6. 产业链与价值量：上游部件、中游设备、系统集成、下游客户及利润池；
7. 技术路线：风冷、冷板液冷、浸没式液冷及关键供配电路线的比较矩阵；
8. 竞争格局：主要参与者定位、能力边界与竞争壁垒；
9. 代表企业比较：仅使用可验证的公开公司与公开指标；
10. 商业模式与单位经济性：采购决策、交付周期、收入质量和扩张约束；
11. 催化剂与风险：按时间和影响程度组织，不写泛泛清单；
12. 投资结论：机会排序、关键验证指标与后续跟踪框架。

信息密度以参考图为目标。除封面外，每页必须有一个明确结论标题、2—4 个相互支撑的信息模块和页尾 takeaway/source；正文页通常应包含 8—15 个可独立读取的事实、标签、指标或判断，且至少使用一种真正承载信息的结构，例如数据图表、对比表、矩阵、产业链、情景拆解或时间轴。不要用一个大标题加三条空泛 bullet 填满一页，也不要为了留白牺牲论证所需的信息。保持可读性：主要正文原则上不小于 9pt，重要结论和关键数字应明显高于正文层级。

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
  artifactExpectation: '一个恰好 12 页、完成公开资料研究、可在 Linnya 查看并可导出为 PPTX 的高信息密度 Slides 文档。',
  humanReview: [
    { id: 'argument', label: '投资论证链', guidance: '问题定义、证据、判断和投资含义前后相接，不是页面清单。' },
    { id: 'density', label: '信息密度', guidance: '正文页具有多个有效信息模块和足够证据，不是大留白海报；密度接近参考图但仍可读。' },
    { id: 'hierarchy', label: '结论与层级', guidance: '标题直接给结论，关键数字、证据、解释、takeaway 和来源层级清楚。' },
    { id: 'evidence', label: '事实与来源', guidance: '关键数字有可靠来源与年份，口径和假设可理解，没有伪造或错误引用。' },
    { id: 'exhibits', label: '咨询图表', guidance: '图表、矩阵、产业链、情景分析和表格真正支撑判断，不是装饰。' },
    { id: 'grid', label: '网格与对齐', guidance: '多模块页面仍保持统一边距、分栏、对齐和页脚，没有拥挤漂移。' },
    { id: 'readability', label: '可读性', guidance: '密度提高后仍无文字竖排、溢出、过小正文或不可读来源。' },
    { id: 'consistency', label: '视觉一致性', guidance: '配色、字体、线条、卡片与强调语言跨 12 页一致。' },
    { id: 'fidelity', label: '预览与导出', guidance: 'Linnya 预览无编译错误；抽查 PPTX 导出与预览接近。' },
  ],
} satisfies BenchmarkCaseDefinition;
