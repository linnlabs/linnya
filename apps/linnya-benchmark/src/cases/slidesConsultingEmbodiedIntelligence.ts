import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';

export const slidesConsultingEmbodiedIntelligenceCase = {
  id: 'slides_consulting_embodied_intelligence_v1',
  revision: 1,
  name: '具身智能投研：十六页高密度咨询报告',
  description: '验证研究、真实图片、数据图表与投资判断能否形成完整的高密度咨询文稿。',
  tags: ['slides', 'consulting', 'high-density', 'web-research', 'chinese'],
  agentId: 'slides_agent',
  reasoningEffort: 'medium',
  timeoutMs: 150 * 60 * 1000,
  promptTemplate: `请制作一份恰好 16 页、16:9 的中文具身智能行业投研 PPT，面向专业投资委员会。采用麦肯锡式咨询报告风格：结论先行、严谨克制、信息密度高，不能做成大标题加三条 bullet 的演讲提纲，也不要使用麦肯锡 Logo 或冒充官方报告。

请自主完成联网调研、分析、设计、制作与检查。以运行当天可获取的公开资料为准，优先一手来源；关键数字标注来源、日期、单位及统计口径，明确区分已发生事实、企业目标、外部预测和你的情景测算。找不到可信数据就说明，不编造数字或引用。研究素材和来源另存项目文件，便于后续复核。

论证应覆盖需求与应用场景、技术路线和落地瓶颈、产业链及价值分配、竞争格局、商业化经济性、投资机会、催化剂和风险。结构与每页内容由你决定，但必须回答哪些环节值得关注、为什么、什么证据能推翻判断。不要只介绍人形机器人外观或汇总融资新闻。

每页都要高密度且可读，封面也应包含核心判断或行业关键事实，不用空白章节页凑数。用矩阵、对比表、产业链、时间轴、情景分析和数据图表承载信息，避免堆砌装饰。必须有与分析相关的真实产品或应用场景图片，并注明来源；概念插画不能冒充真实产品或研究证据。图形可用 SVG，文本与主要分析内容保留可编辑性。

保留严谨网格、清晰层级、统一页码和来源区；不能靠过小字号硬塞内容。按 Slides skill 分批创建页面，完成后检查全部 16 页，修复真实的重叠、溢出、编号竖排、图表口径和图片问题。只新建本任务文件，不覆盖或删除现有文稿。

最终交付 .slides 文稿和研究资料，说明文件路径、页数、检查情况，以及仍需人工判断的不确定性。`,
  inputs: [],
  interaction: { awaitingUser: 'approve', maxResponses: 4 },
  artifactExpectation: '恰好 16 页的具身智能咨询 Slides；包含真实图片、可追溯数据、分析结论和单独的研究资料。',
  humanReview: [
    { id: 'argument', label: '论证与投资判断', guidance: '事实、机制、投资含义与反证条件形成闭环。' },
    { id: 'evidence', label: '证据与来源', guidance: '关键数据及图片有来源，预测和测算不冒充事实。' },
    { id: 'density', label: '信息密度', guidance: '逐页检查有效信息量与可读性，不以字数或元素数量代替质量。' },
    { id: 'design', label: '咨询视觉', guidance: '图表与版式服务分析，配色、网格、层级和来源区一致。' },
    { id: 'layout', label: '布局与检查', guidance: '核实 inspect 反馈和真实页面，区分缺陷与有意视觉关系。' },
    { id: 'fidelity', label: '产物完整性', guidance: '16 页可编译、可预览；PowerPoint 一致性单列人工验收，不冒充已验证。' },
  ],
} satisfies BenchmarkCaseDefinition;
