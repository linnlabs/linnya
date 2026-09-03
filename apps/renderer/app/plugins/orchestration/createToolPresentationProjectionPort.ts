import type { ToolPresentationProjectionPort } from '@/domains/conversation/ports/toolPresentationProjectionPort';
import { resolveToolUiConfigWithKey } from '@/domains/conversation/ui/tools/registry';
import { isRecord } from '@/domains/conversation/utils/typeGuards';

type ResolveToolUiConfig = typeof resolveToolUiConfigWithKey;

function readFieldState(value: unknown, key: string): 'missing' | 'empty' | 'valid' | 'non_string' {
  if (!isRecord(value) || !(key in value)) return 'missing';
  const field = value[key];
  if (typeof field !== 'string') return 'non_string';
  return field.trim().length > 0 ? 'valid' : 'empty';
}

function reportProjectionFailure(
  request: Parameters<NonNullable<ToolPresentationProjectionPort['project']>>[0],
  uiKey: string | undefined,
  error: unknown,
): void {
  const args = request.args;
  const result = request.result;
  console.error('[ToolPresentationProjection] projector failed', {
    sourceToolName: request.sourceToolName,
    uiKey,
    toolCallId: request.toolCallId,
    status: request.status,
    phase: request.phase,
    argKeys: isRecord(args) ? Object.keys(args) : [],
    path: readFieldState(args, 'path'),
    inode: readFieldState(args, 'inode'),
    resultShape: isRecord(result)
      ? Object.keys(result)
      : typeof result,
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * app-level adapter：插件 registry 拥有 alias 与 projector，Conversation 只依赖窄 port。
 */
export function createToolPresentationProjectionPort(
  resolveToolUiConfig: ResolveToolUiConfig = resolveToolUiConfigWithKey,
): ToolPresentationProjectionPort {
  return {
    project(request) {
      let resolved: ReturnType<ResolveToolUiConfig> | undefined;
      try {
        resolved = resolveToolUiConfig(
          request.sourceToolName,
          request.args,
          request.result,
        );
        const projector = resolved?.config.presentation;
        if (!resolved || !projector) return undefined;

        const projection = projector({
          ...request,
          uiKey: resolved.uiKey,
        });
        return {
          uiKey: resolved.uiKey,
          status: request.status,
          phase: request.phase,
          ...projection,
        };
      } catch (error) {
        reportProjectionFailure(request, resolved?.uiKey, error);
        throw error;
      }
    },
  };
}
