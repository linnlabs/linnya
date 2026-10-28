import type { DecisionRecord, DecisionRecommendation, DecisionModel } from '../../../../shared';
import { evaluateDecisionModel } from './evaluateDecisionModel';
import { projectNumericBasis, validateNumericBasis } from './projectNumericBasis';
import { projectRecommendationContext } from './projectRecommendationContext';

export function validateRecommendationBasis(model: DecisionModel, content: DecisionRecommendation): void {
  if (content.numericBasis) validateNumericBasis(model, content.numericBasis);
}

export function projectRecommendationBasis(record: DecisionRecord, evaluation: ReturnType<typeof evaluateDecisionModel>) {
  const recommendation = record.recommendation;
  if (!recommendation?.content.numericBasis) return null;
  const basedOnInputRevision = recommendation.basedOnInputRevision;
  // 写前check可以看当前模型，但旧建议仍只能作为待复核历史保留，不能借预览重新接纳。
  if (projectRecommendationContext(record).status !== 'current') return { status: 'needs_review', basedOnInputRevision } as const;
  return {
    status: 'current' as const, basedOnInputRevision,
    ...projectNumericBasis(record.model, recommendation.content.numericBasis, evaluation),
    notice: '程序只投影已声明的算式与单变量边界；其他输入保持当前值。数值变化条件由numericBasis生成；它不核实来源、单位、模型或自由文字，不自动判定改选及全局最优。',
  };
}
