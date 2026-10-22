/**
 * @file markdownChartSpecSchema.ts
 * @description 完整的图表规格 schema：形状（含图表类型判别）+ 字段间规则。
 *
 * 持久化节点属性校验使用该 schema。写入入口应使用 `admitMarkdownChartSpec`，
 * 它在同一规则之上产出规范化规格和可修复的诊断。
 */

import { MarkdownChartSpecShapeSchema } from '../definitions/markdownChartSpec';
import { checkMarkdownChartRules } from './checkMarkdownChartRules';

export const MarkdownChartSpecSchema = MarkdownChartSpecShapeSchema.superRefine((spec, context) => {
  for (const issue of checkMarkdownChartRules(spec)) {
    context.addIssue({
      code: 'custom',
      path: [...issue.path],
      message: issue.message,
      params: { diagnosticCode: issue.code },
    });
  }
});
