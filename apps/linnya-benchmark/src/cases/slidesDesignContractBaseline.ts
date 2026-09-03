import type { BenchmarkCaseDefinition } from '../definitions/benchmarkCase';
import {
  buildSlidesDesignContractExperimentPrompt,
  slidesDesignContractHumanReview,
} from './slidesDesignContractExperiment';

export const slidesDesignContractBaselineCase = {
  id: 'slides_design_contract_baseline_v1',
  revision: 1,
  name: 'Slides 最小设计合同实验：基线组',
  description: '使用现有 Slides Skill 与普通设计要求生成电网侧储能决策稿，不注入额外设计合同。',
  tags: ['slides', 'design-system', 'ab-test', 'baseline', 'chinese'],
  agentId: 'slides_agent',
  reasoningEffort: 'high',
  timeoutMs: 90 * 60 * 1000,
  promptTemplate: buildSlidesDesignContractExperimentPrompt({
    outputLocator: 'workspace:/phase2-design-contract-baseline.slides',
  }),
  inputs: [],
  interaction: { awaitingUser: 'approve', maxResponses: 4 },
  artifactExpectation: '一份恰好 12 页、基于项目既有资料的电网侧储能决策型 Slides 文稿。',
  humanReview: slidesDesignContractHumanReview,
} satisfies BenchmarkCaseDefinition;
