import type { BenchmarkHumanReviewCriterion } from '../definitions/benchmarkCase';

const commonBrief = `请只使用当前 Workspace 项目中已经存在的资料，制作一份恰好 12 页、16:9 的中文决策型 PPT，主题为《电网侧储能：从容量扩张到收益质量》。不要联网搜索，也不要沿用已有 .slides 的版式或复制其 deck.js；已有文稿只可作为事实材料读取。

受众是需要判断未来两年机会优先级的能源产业投资决策委员会。文稿必须回答：电网侧储能为什么从装机叙事转向收益质量、收益由什么构成、哪些环节能够持续获得价值、接下来应跟踪什么。它不是行业科普、政策汇编或演讲提纲。

两组实验使用相同的内容边界：
1. 封面；
2. 执行结论；
3. 从装机增长转向收益质量的核心矛盾；
4. 电力市场与储能参与机制；
5. 收益堆叠及不同来源的稳定性；
6. 典型项目经济性与敏感性；
7. 产业链价值分配；
8. 技术路线与系统能力比较；
9. 竞争格局与能力边界；
10. 区域机会或市场成熟度比较；
11. 催化剂、风险与验证信号；
12. 机会排序与行动建议。

只采用项目资料中能够核实的事实和数字；页面内标明来源文件或资料名称，无法核实的数字不要编造。正文页应有足够证据支撑标题结论，但不能通过缩小到不可读字号来制造密度。使用 Slides 原生可编辑文本、图表、表格和简单形状；复杂关系只有确有必要时才使用不含文字的 SVG，并用原生 Text 标注。

新建文稿，提交逐页计划并等待批准。完成后执行编译、整份 inspect 和最终 revision 的全页 render，结合真实像素修复非预期断行、字号过小、遮挡、裁切、图表语义不足以及连续卡片堆叠。`;

export const slidesDesignContractHumanReview = [
  { id: 'argument', label: '决策论证', guidance: '页面共同回答收益质量与机会优先级，而不是资料目录。' },
  { id: 'density', label: '有效信息密度', guidance: '正文页具有足够证据、解释和判断，同时保持真实可读。' },
  { id: 'structure', label: '结构匹配', guidance: '比较、因果、流程、数据和结论使用与关系相符的页面结构。' },
  { id: 'anchor', label: '视觉锚点', guidance: '正文页有清晰主展项或主结论，阅读入口明确。' },
  { id: 'rhythm', label: '跨页节奏', guidance: '相邻页面骨架有合理变化，不连续堆叠同一种卡片网格。' },
  { id: 'hierarchy', label: '信息层级', guidance: '标题、主证据、解释、关键数字与来源层级清晰。' },
  { id: 'readability', label: '可读性', guidance: '无竖排、溢出、遮挡、过小正文或不可读来源。' },
  { id: 'consistency', label: '视觉一致性', guidance: '字体、颜色、网格、图表和强调语义跨页稳定。' },
] satisfies readonly BenchmarkHumanReviewCriterion[];

export function buildSlidesDesignContractExperimentPrompt(request: {
  readonly outputLocator: string;
  readonly designContract?: string;
}): string {
  const contract = request.designContract ? `\n\n${request.designContract}` : '';
  return `${commonBrief}${contract}\n\n请将最终文稿写入 \`${request.outputLocator}\`。`;
}
