import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';

export const slidesArgFrontierComplexCase = {
  id: 'slides_arg_frontier_complex_v1',
  revision: 1,
  name: 'ARG 前沿学术稿：20 页与复杂数据图表',
  description: '检验真实 Agent 的文献检索、模拟数据计算、复杂图表、完整质检与交付能力。',
  tags: ['slides', 'academic', 'data-integrity', 'complex-charts', 'chinese'],
  agentId: 'slides_agent',
  reasoningEffort: 'high',
  timeoutMs: 60 * 60 * 1000,
  promptTemplate: `制作一个恰好 20 页的中文学术 PPT，题目《抗生素抗性基因传播：前沿证据与 One Health 监测》。面向微生物生态与公共卫生研究生组会，要符合截至今天的前沿研究。

输出为当前项目中的 workspace:/arg-frontier-complex-v1.slides，不要覆盖或读取其他已有文稿，不要参考其他评测报告或答案。仅使用下方输入和独立检索的公开来源。请独立完成资料查找、数据计算、设计、编译、预览和纠错。使用白底、深蓝与青绿的学术风格，16:9，正文可读，图表占据足够空间。不调用其他模型或图片生成模型代做图表。

数据输入文件：{{dataset}}
该 JSON 全部是明确标记的教学模拟数据，不代表真实样本、研究或风险。请读取并计算，不要另造数字替换它。真实文献证据与模拟图表分开叙述，涉及模拟数据的每页均显著写明“教学模拟数据”。不要把关联、共现或记录流向写成已证实的传播因果关系。

内容要求：包含 ARG 与 AMR 的区别、水平基因转移的概念框架、环境和宿主关联的证据等级、One Health 监测、长读长/宏基因组等方法的推断局限、研究争议与开放问题。核心是综述与监测解释，不提供培养、转移或耐药增强的操作方案。至少使用 8 项可核验文献，其中至少 4 项 2024 年及以后的原始研究；涉及 2026 年进展必须核对正式发表或预印本状态，不凭年份猜测。每项关键结论页内有来源短引，最后参考文献页给出标题、年份和 DOI/URL。明确区分耐药相关死亡与耐药归因死亡等口径。

20 页中必须包含以下七种数据证据图，允许合理组合，但不能用文字列表代替：
1. heatmap 的 12 站点 × 8 类别热图。保留全部标签、色标和单位，null 与 0 使用不同视觉编码。
2. time_series 的 24 个月 × 3 组检出比例折线图。按每月 positive/n 计算，百分比轴与图例准确。
3. flows 的三阶段桑基图。节点和流量守恒，标注总记录数，说明这是模拟记录分类而非生物传播因果。
4. forest 的六项假想研究森林图。点估计、95% 区间、参照线 1 与对数轴正确，不计算或伪称真实合并效应。
5. scatter 的 36 点分组气泡散点图。x/y/size 对应单位正确，颜色对应组，不能把趋势写成因果。
6. composition 的四组 100% 堆积图，逐组按同一分母归一化，不把计数直接当百分比。
7. raw_qc 的数据处理流程与结果表。遵循文件内去重、QC、缺失、删失和单位规则，报告每一步保留/剔除数量、精确数值主分析均值，以及删失替代敏感性均值。不要把缺失填零。

请在项目内保存数据计算过程和派生数据，确保所有重复出现的数字、图例颜色、来源与单位一致。图表优先采用可编辑数据图；使用渲染图或不支持的导出类型时，应如实说明编辑性限制。

交付前逐批检查全部 20 页，覆盖后十页；修复编译错误、明显越界、遮挡、图例/标签裁切。最后说明文稿路径、准确页数、全页检查覆盖，以及确实尚未解决的问题，不把部分检查当整稿验收。`,
  inputs: [{ key: 'dataset', label: '模拟监测数据 JSON', kind: 'absolute_file', required: true }],
  interaction: { awaitingUser: 'manual', maxResponses: 0 },
  artifactExpectation: '20 页学术 Slides 文稿，七种完整数据图、可追溯文献与模拟数据计算记录。',
  humanReview: [
    { id: 'evidence', label: '证据与前沿性', guidance: '逐项核验文献身份、年份和关键论断，区分原始研究、综述及预印本。' },
    { id: 'data', label: '数据正确性', guidance: '独立复算比例、归一化、守恒、去重/QC/删失与单位处理；不接受仅图形相似。' },
    { id: 'charts', label: '复杂图表', guidance: '七类图均存在，编码、全部数据点、区间和标签正确，披露可编辑性。' },
    { id: 'visual', label: '全页视觉', guidance: '逐页观察真实渲染，复核清晰度、遮挡、密度以及导出一致性。' },
    { id: 'execution', label: '执行与收敛', guidance: '统计真实模型调用、token、耗时、错误与重复修复，不把测试提示当收益证明。' },
  ],
} satisfies BenchmarkCaseDefinition;
