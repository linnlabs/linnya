import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';
import {
  buildSlidesDesignContractExperimentPrompt,
  slidesDesignContractHumanReview,
} from './slidesDesignContractExperiment';

const designContract = `除上述共同要求外，生成前采用下面这份最小设计意图合同。它只约束设计决策，不是固定坐标模板：

- 沟通任务：让投资决策委员会在十分钟内看清“收益质量比装机规模更能区分机会”，并形成机会优先级。
- 整稿节奏：开篇定判断，中段依次完成机制、经济性、价值分配和竞争证据，结尾收束为验证信号与行动；密集证据页之间允许一页相对克制的综合或过渡页。
- 页面结构：先判断内容关系，再从主图配注释、左右论证、过程/价值链、对比矩阵、情景或敏感性图、时间/催化剂轴、结论排序中选择；相邻三页不得重复同一种骨架，不把所有内容默认做成等宽卡片。
- 视觉锚点：每个正文页只设一个主展项或主结论，其余元素作为证据和注释从属；重要数字通过尺度、位置和留白建立层级，而不是同时叠加多种强调色和描边。
- 素材策略：数据关系优先用原生 Chart/Table，机制关系优先用简单原生几何；图片只在能提供证据或建立情境时使用，SVG 不承载文字，也不用于装饰性复杂插画。

合同不得变成第二份页面源码；最终 deck.js 仍由内容关系决定。`;

export const slidesDesignContractIntentCase = {
  id: 'slides_design_contract_intent_v1',
  revision: 1,
  name: 'Slides 最小设计合同实验：合同组',
  description: '在与基线组相同的内容要求上注入最小设计意图合同，验证它是否改变 Agent 的设计决策。',
  tags: ['slides', 'design-system', 'ab-test', 'design-intent', 'chinese'],
  agentId: 'slides_agent',
  reasoningEffort: 'high',
  timeoutMs: 90 * 60 * 1000,
  promptTemplate: buildSlidesDesignContractExperimentPrompt({
    outputLocator: 'workspace:/phase2-design-contract-intent.slides',
    designContract,
  }),
  inputs: [],
  interaction: { awaitingUser: 'approve', maxResponses: 4 },
  artifactExpectation: '一份恰好 12 页、应用最小设计意图合同的电网侧储能决策型 Slides 文稿。',
  humanReview: slidesDesignContractHumanReview,
} satisfies BenchmarkCaseDefinition;
