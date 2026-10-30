import { defineComponent } from 'vue';
import { z } from 'zod';
import type { ToolUiConfig, ToolPresentationProjectorInput, ToolCompactStepProjectorInput } from '@linnya/plugin-host-contract/renderer/toolUi';

const savedIdentity = z.object({ kind: z.literal('decision_delivery_export'), decisionId: z.string().uuid(), revision: z.number().int().positive() });

function title(input: ToolPresentationProjectorInput | ToolCompactStepProjectorInput) {
  if (input.status !== 'success') return {
    key: input.status === 'error' ? 'decision.delivery.failed' : 'decision.delivery.preparing',
    fallback: input.status === 'error' ? '决策交付未完成' : '生成决策交付',
  };
  const { data } = z.object({ data: savedIdentity }).parse(input.result);
  return { key: 'decision.delivery.completed', fallback: '已交付决策第 {revision} 版', params: { revision: String(data.revision) } };
}

/** 正文由正式 final_answer 展示；卡片只标记这次版本交付，避免复制整份报告。 */
export const decisionFinishCard: ToolUiConfig = {
  component: defineComponent({ setup: () => () => null }),
  presentation: input => ({ data: {}, title: { text: title(input) }, hideContent: true }),
  compactStep: input => ({ title: title(input) }),
  layout: { hideContent: true },
};
