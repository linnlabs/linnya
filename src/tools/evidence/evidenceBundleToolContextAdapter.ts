/**
 * Evidence bundle-store 的 Linnya ToolContext adapter。
 *
 * Evidence domain 只接收明确的 conversation scope 与审计字段；
 * 这个 adapter 是唯一允许从 ToolContext 投影这些事实的边界。
 */
import type { ToolExecutionContext } from 'linnkit/runtime-kernel';
import {
  saveEvidenceBundle,
  type KnowledgeBaseEvidenceItem,
  type WebEvidenceItem,
} from '../../domains/evidence';
import {
  requireToolConversationScope,
  type ToolConversationScopeContext,
} from 'src/app-hosts/linnya/adapters/tools/conversation-scope';

type EvidenceToolContext = ToolExecutionContext & ToolConversationScopeContext;

function resolveEvidenceBundleScope(context: EvidenceToolContext): {
  conversationId: string;
  instanceId: string;
} {
  return requireToolConversationScope({
    context,
    errorPrefix: '[EvidenceStore]',
  });
}

function projectEvidenceAudit(context: EvidenceToolContext): {
  turnId?: string;
  toolCallId?: string;
} {
  return {
    turnId: typeof context.turnId === 'string' ? context.turnId : undefined,
    toolCallId: typeof context.parentToolCallId === 'string' ? context.parentToolCallId : undefined,
  };
}

export async function saveEvidenceBundleFromToolContext(
  params:
    | {
        context: EvidenceToolContext;
        kind: 'knowledge_evidence';
        query: string;
        summary?: string;
        items: KnowledgeBaseEvidenceItem[];
      }
    | {
        context: EvidenceToolContext;
        kind: 'web_evidence';
        query: string;
        summary?: string;
        items: WebEvidenceItem[];
      }
): Promise<{ bundleId: string; filePath: string }> {
  const scope = resolveEvidenceBundleScope(params.context);
  const audit = projectEvidenceAudit(params.context);
  if (params.kind === 'knowledge_evidence') {
    return saveEvidenceBundle({
      scope,
      audit,
      kind: params.kind,
      query: params.query,
      summary: params.summary,
      items: params.items,
    });
  }
  return saveEvidenceBundle({
    scope,
    audit,
    kind: params.kind,
    query: params.query,
    summary: params.summary,
    items: params.items,
  });
}
