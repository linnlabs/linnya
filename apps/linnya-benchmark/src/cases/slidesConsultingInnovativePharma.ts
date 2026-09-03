import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';

export const slidesConsultingInnovativePharmaCase = {
  id: 'slides_consulting_innovative_pharma_v1',
  revision: 1,
  name: '咨询风格 Slides：中国创新药出海与全球授权交易',
  description: '验证 Agent 能否完成一份二十二页、结论先行的创新药出海战略与投资咨询报告。',
  tags: ['slides', 'consulting', 'high-density', 'long-run', 'web-research', 'chinese'],
  agentId: 'slides_agent',
  reasoningEffort: 'high',
  timeoutMs: 150 * 60 * 1000,
  promptTemplate: `请制作一份恰好 22 页、16:9 的中文咨询/投研风格 PPT，主题为《中国创新药出海：全球授权交易、能力迁移与价值重估》。这是一次真实咨询报告测试，不是医药科普、新闻汇编或演讲提纲。

视觉参考图片位于：{{reference_image}}

请先读取参考图片，只学习其设计语言和信息组织方式：结论式标题、深蓝/白/少量金色的克制配色、严格网格、同页多模块、产业链拆解、竞争矩阵、重点高亮、页尾结论与来源。不要复制图片中的光源资本名称、Logo、公司名称、原文数据或具体文案，也不要把参考图直接铺成页面背景。

请使用公开可信资料完成必要研究，数据口径尽量截至 2026 年 8 月。优先使用药监机构、证券交易所披露、上市公司公告/年报、ClinicalTrials.gov、WHO、企业官方公告和高质量行业数据库或研究机构。关键交易金额必须区分首付款、里程碑和潜在总金额；管线数据要标明阶段与统计时间；医学与商业判断不得混淆。无法确认的数据不要编造，也不要给出医疗建议。

成品必须恰好 22 页，并形成“全球需求与供给变化—中国研发能力形成—交易模式演化—资产与平台价值—竞争格局—成功条件—风险—战略与投资判断”的连续论证链。至少覆盖：封面、执行摘要、核心判断、全球研发生产率背景、中国创新药能力迁移、政策与资本环境、跨境交易趋势、交易金额与结构、NewCo/License-out/合作开发模式比较、热门靶点与技术平台、肿瘤领域、免疫与自免领域、代谢与 GLP-1 相关领域、ADC/双抗/细胞与基因治疗平台、临床与注册能力、CMC 与供应链、代表性交易案例、企业竞争矩阵、资产估值与风险调整框架、未来三年情景推演、风险与失败模式、战略建议及投资跟踪指标。允许合理合并相近内容，但不得减少页数或用空洞过渡页凑数。

除封面外，每页必须有一句可以独立阅读的结论标题、2—4 个相互支撑的信息模块和页尾 takeaway/source。正文页通常应包含 8—15 个可独立读取的事实、标签、指标或判断，并至少使用一种真正承载信息的结构，例如交易趋势图、漏斗、价值链、模式对比、竞争矩阵、管线热力图、案例卡片、风险调整估值桥、情景推演或表格。不要用一个大标题加三条泛泛 bullet 填满一页，也不要为了留白牺牲论证所需的信息。

保持咨询报告的可读性与克制感：主要正文原则上不小于 9pt，标题、关键数字和战略含义应有清晰层级；不要让两位数页码、序号或年份竖排；图表必须有单位、口径、图例和来源。优先使用 Slides 原生可编辑元素，复杂关系图可使用不含文字的 SVG 图形并叠加原生 Text，避免用大量基础形状拼复杂插画。

完成后必须执行编译、整份 inspect 和至少 6 个代表页面的 render 检查，覆盖高密度表格、矩阵、趋势图、案例页与结论页。根据检查结果修复文字竖排、溢出、遮挡、错位、来源不可读、空洞页面、跨页样式漂移和明显误报处置后再交付。最终回答简要说明文稿路径、页数、检查范围和仍需人工判断的事项。`,
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
  artifactExpectation: '一个恰好 22 页、完成公开资料研究、可在 Linnya 查看并可导出为 PPTX 的高信息密度创新药出海咨询 Slides 文档。',
  humanReview: [
    { id: 'argument', label: '咨询论证链', guidance: '行业变化、交易模式、能力、价值与战略含义前后相接，不是新闻罗列。' },
    { id: 'density', label: '信息密度', guidance: '正文页具有多个有效信息模块和足够证据，不是大留白海报。' },
    { id: 'evidence', label: '事实与来源', guidance: '交易结构、管线阶段和金额口径准确，来源与统计时间清晰。' },
    { id: 'exhibits', label: '咨询图表', guidance: '趋势、漏斗、矩阵、案例、估值桥和情景推演真正支撑判断。' },
    { id: 'grid', label: '网格与对齐', guidance: '多模块页面仍保持统一边距、分栏、对齐和页脚。' },
    { id: 'readability', label: '可读性', guidance: '无文字竖排、溢出、遮挡、过小正文或不可读来源。' },
    { id: 'consistency', label: '视觉一致性', guidance: '配色、字体、线条、卡片与强调语言跨页一致。' },
    { id: 'fidelity', label: '预览与导出', guidance: 'Linnya 预览无编译错误；PPTX 导出需要后续人工抽查。' },
  ],
} satisfies BenchmarkCaseDefinition;
