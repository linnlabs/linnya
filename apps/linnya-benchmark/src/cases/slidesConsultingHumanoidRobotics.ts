import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';

export const slidesConsultingHumanoidRoboticsCase = {
  id: 'slides_consulting_humanoid_robotics_v1',
  revision: 1,
  name: '咨询风格 Slides：中国人形机器人商业化与核心零部件',
  description: '验证 Agent 能否完成一份二十二页、结论先行的人形机器人产业与投资咨询报告。',
  tags: ['slides', 'consulting', 'high-density', 'long-run', 'web-research', 'chinese'],
  agentId: 'slides_agent',
  reasoningEffort: 'high',
  timeoutMs: 150 * 60 * 1000,
  promptTemplate: `请制作一份恰好 22 页、16:9 的中文咨询/投研风格 PPT，主题为《2026 年中国人形机器人商业化路径与核心零部件投资机会》。这是一次真实咨询报告测试，不是概念海报、新闻汇编或演讲提纲。

视觉参考图片位于：{{reference_image}}

请先读取参考图片，只学习其设计语言和信息组织方式：结论式标题、深蓝/白/少量金色的克制配色、严格网格、同页多模块、产业链拆解、竞争矩阵、重点高亮、页尾结论与来源。不要复制图片中的光源资本名称、Logo、公司名称、原文数据或具体文案，也不要把参考图直接铺成页面背景。

请使用公开可信资料完成必要研究，数据口径尽量截至 2026 年 8 月。优先使用政府与监管机构、上市公司公告/年报、企业官方技术资料、国际组织、行业协会和高质量研究机构等一手来源。关键数字必须在相应页面标明来源与年份；预测值要区分事实、外部预测和自行测算，无法确认的数据不要编造。

成品必须恰好 22 页，并形成“需求场景—技术成熟度—成本曲线—产业链价值量—竞争格局—商业化节奏—投资判断”的连续论证链。至少覆盖：封面、执行摘要、核心判断、应用场景优先级、全球与中国发展阶段、政策与资本驱动、整机技术架构、感知与控制、减速器、丝杠、伺服与电机、传感器、灵巧手、材料与结构件、电池与热管理、算力与模型、单机价值量拆解、成本下降路径、量产瓶颈、国内外竞争格局、情景测算与催化剂、风险及投资结论。允许合理合并相近内容，但不得减少页数或用空洞过渡页凑数。

除封面外，每页必须有一句可以独立阅读的结论标题、2—4 个相互支撑的信息模块和页尾 takeaway/source。正文页通常应包含 8—15 个可独立读取的事实、标签、指标或判断，并至少使用一种真正承载信息的结构，例如价值链、BOM 瀑布、成本曲线、竞争矩阵、场景优先级矩阵、技术路线对比、情景测算、时间轴或表格。不要用一个大标题加三条泛泛 bullet 填满一页，也不要为了留白牺牲论证所需的信息。

保持咨询报告的可读性与克制感：主要正文原则上不小于 9pt，标题、关键数字和投资含义应有清晰层级；不要让两位数页码、序号或年份竖排；图表必须有单位、口径、图例和来源。优先使用 Slides 原生可编辑元素，复杂关系图可使用不含文字的 SVG 图形并叠加原生 Text，避免用大量基础形状拼复杂插画。

完成后必须执行编译、整份 inspect 和至少 6 个代表页面的 render 检查，覆盖高密度表格、矩阵、图表、产业链与结论页。根据检查结果修复文字竖排、溢出、遮挡、错位、来源不可读、空洞页面、跨页样式漂移和明显误报处置后再交付。最终回答简要说明文稿路径、页数、检查范围和仍需人工判断的事项。`,
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
  artifactExpectation: '一个恰好 22 页、完成公开资料研究、可在 Linnya 查看并可导出为 PPTX 的高信息密度人形机器人咨询 Slides 文档。',
  humanReview: [
    { id: 'argument', label: '咨询论证链', guidance: '需求、技术、成本、竞争与投资含义前后相接，不是产业资料堆积。' },
    { id: 'density', label: '信息密度', guidance: '正文页具有多个有效信息模块和足够证据，不是大留白海报。' },
    { id: 'evidence', label: '事实与来源', guidance: '关键数字有可靠来源与年份，事实、预测和自行测算口径明确。' },
    { id: 'exhibits', label: '咨询图表', guidance: '价值链、BOM、矩阵、成本曲线和情景测算真正支撑判断。' },
    { id: 'grid', label: '网格与对齐', guidance: '多模块页面仍保持统一边距、分栏、对齐和页脚。' },
    { id: 'readability', label: '可读性', guidance: '无文字竖排、溢出、遮挡、过小正文或不可读来源。' },
    { id: 'consistency', label: '视觉一致性', guidance: '配色、字体、线条、卡片与强调语言跨页一致。' },
    { id: 'fidelity', label: '预览与导出', guidance: 'Linnya 预览无编译错误；PPTX 导出需要后续人工抽查。' },
  ],
} satisfies BenchmarkCaseDefinition;
