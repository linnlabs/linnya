import type {
  ToolCompactStepProjectionPort,
  ToolCompactStepProjectionRequest,
} from '@/domains/conversation/ports/toolCompactStepProjectionPort';
import { ToolCompactStepProjectionError } from '@/domains/conversation/ports/toolCompactStepProjectionPort';
import { resolveToolUiConfigWithKey } from '@/domains/conversation/ui/tools/registry';

type ResolveToolUiConfig = typeof resolveToolUiConfigWithKey;

/** app-level adapter：复用唯一 Renderer registry 与 alias 规则。 */
export function createToolCompactStepProjectionPort(
  resolveToolUiConfig: ResolveToolUiConfig = resolveToolUiConfigWithKey,
): ToolCompactStepProjectionPort {
  return {
    project(request) {
      let resolved: ReturnType<ResolveToolUiConfig> | undefined;
      try {
        resolved = resolveToolUiConfig(
          request.sourceToolName,
          request.args,
          request.result,
        ) ?? undefined;
        const projector = resolved?.config.compactStep;
        if (!resolved || !projector) return undefined;

        return projector({
          ...request,
          uiKey: resolved.uiKey,
        });
      } catch (error) {
        throw new ToolCompactStepProjectionError({
          sourceToolName: request.sourceToolName,
          uiKey: resolved?.uiKey,
          toolCallId: request.toolCallId,
          status: request.status,
          phase: request.phase,
        }, error);
      }
    },
  };
}
