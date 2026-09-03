import { computed, shallowRef } from 'vue';
import type {
  ToolLocalizedTextDescriptor,
} from '@linnya/plugin-host-contract/renderer/toolUi';
import type { ConversationToolMessageStatus } from '@app/schemas';

import { createAppendOnlySubrunStepProjector } from '../functions/createAppendOnlySubrunStepProjector';
import { useAppendOnlySubrunTrace } from './useAppendOnlySubrunTrace';

/**
 * 从实时 child trace 派生父工具卡的当前步骤标题。
 *
 * 这里复用紧凑步骤 projector，只在父工具仍执行且已有真实 tool_process/tool_output
 * 时覆盖原始标题；首步之前和终态继续由父工具 presentation 提供标题。
 */
export function useSubrunCompactStepTitle(params: {
  readonly enabled: () => boolean;
  readonly status: () => ConversationToolMessageStatus;
  readonly subrunTrace: () => unknown;
  readonly subrunTraceVersion: () => number;
}) {
  const projector = createAppendOnlySubrunStepProjector();
  const steps = shallowRef(projector.projection.steps);

  useAppendOnlySubrunTrace({
    subrunTrace: () => params.enabled() ? params.subrunTrace() : undefined,
    version: params.subrunTraceVersion,
    onReset: () => {
      projector.reset();
      steps.value = projector.projection.steps;
    },
    onEvents: events => {
      projector.admit(events);
      steps.value = projector.projection.steps;
    },
  });

  const title = computed<ToolLocalizedTextDescriptor | undefined>(() => {
    if (!params.enabled() || params.status() !== 'loading') return undefined;
    return steps.value[steps.value.length - 1]?.title;
  });

  return { title };
}
