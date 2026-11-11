import { JsonValueSchema } from '@app/schemas';
import type { MarkdownDocJson } from '../../normalization/runtime';
import { attachCitationNodesToDocJson } from '../../normalization/runtime';
import { flattenMarkdownDocumentBlocks, serializeMarkdownBlocks } from '../../../shared';
import { parsePendingMetadata } from '../../pending-revisions/functions/pendingRevisionApplyRules';
import { extractPendingCitationHydration, extractPendingCitationLinkHydration } from '../../pending-revisions/functions/admitPendingCitationHydration';
import type { PendingRevision, PendingRevisionMetadata } from '../../pending-revisions/definitions/pendingRevision';
import type { MarkdownDocumentReferencesPort } from '../definitions/markdownDocumentReferences';
import { collectMarkdownDocumentReferences, readPendingDocumentReferenceBindings, referenceBaselineContent, projectMarkdownReferenceContent } from './markdownReferenceContent';

/** 部分决策重写剩余 Markdown 时，仍从已存身份恢复；改名不能让旧/新路径变成另一个标签。 */
export function prepareRemainingReferenceRevision(input: {
  readonly port: MarkdownDocumentReferencesPort | undefined;
  readonly documentId: string; readonly baseline: MarkdownDocJson; readonly pending: PendingRevision;
  readonly remainingContent: MarkdownDocJson; readonly remainingMarkdown: string;
}): { readonly markdown: string; readonly metadata: PendingRevisionMetadata } {
  const metadata = parsePendingMetadata(input.pending.meta_json) ?? {};
  const root = input.baseline.content.find(node => node.attrs?.id === input.pending.target_block_id);
  const baseline = { type: 'doc', content: root ? [root] : [] };
  const previous = readPendingDocumentReferenceBindings(metadata);
  if (!previous.length && !collectMarkdownDocumentReferences(baseline).length) return { markdown: input.remainingMarkdown, metadata };
  if (!input.remainingMarkdown.trim()) return { markdown: '', metadata: { ...metadata, document_reference_bindings: [] } };
  const port = input.port; if (!port) throw new Error('Markdown document reference port is not bound to this database.');
  const current = port.project({ sourceDocumentId: input.documentId, content: referenceBaselineContent(baseline, [input.pending]) });
  if (current.unprojectableReferenceIds.length) throw new Error('部分处理包含无法无损投影的文档引用，请使用整块接受或拒绝。');
  const canonical = port.hydrate({ content: JsonValueSchema.parse(input.remainingContent), bindings: [...previous, ...current.bindings] });
  const projected = projectMarkdownReferenceContent(port, input.documentId, canonical);
  const citations = attachCitationNodesToDocJson(projected.content, extractPendingCitationHydration(metadata, input.pending.target_block_id) ?? {}, extractPendingCitationLinkHydration(metadata, input.pending.target_block_id) ?? {});
  const blocks = flattenMarkdownDocumentBlocks(citations, { projectInlineNode: node => node.type === 'citationNode' && typeof node.attrs['ref'] === 'string' ? `[@${node.attrs['ref']}]` : null });
  return { markdown: serializeMarkdownBlocks(blocks), metadata: { ...metadata, document_reference_bindings: projected.bindings } };
}
