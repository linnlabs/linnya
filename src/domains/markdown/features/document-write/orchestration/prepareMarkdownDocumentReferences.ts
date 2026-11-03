import { admitDocumentCitations } from '../../../../citation';
import { JsonValueSchema, type DocumentReferenceMarkdownBinding } from '@app/schemas';
import { parseMarkdownDocJson, planMarkdownBlocks, type MarkdownDocJson } from '../../normalization';
import { collectMarkdownDocumentReferences, referenceBaselineContent, type MarkdownDocumentReferencesPort } from '../../document-references';
import { flattenMarkdownDocumentBlocks } from '../../../shared';
import type { PendingRevisionMetadata, MarkdownPendingRevisionLike } from '../../pending-revisions';
import { serializeMarkdownFileWriteTarget } from '../functions/serializeMarkdownFileWriteTarget';

function projectTag(bindings: readonly DocumentReferenceMarkdownBinding[], attrs: Readonly<Record<string, unknown>>): string {
  const binding = bindings.find(candidate => candidate.referenceId === attrs['referenceId']);
  if (!binding) throw new Error('Admitted document reference has no Markdown binding.');
  const label = binding.label.replace(/[\[\]\\]/g, character => '\\' + character);
  const path = 'workspace:' + binding.path.slice('workspace:'.length).split('/').map(segment => encodeURIComponent(segment).replace(/[()]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase())).join('/');
  return `[${label}](${path})`;
}
/** 文件正文仍为 Markdown；只把已经解析、接纳的稳定身份写入对应 pending metadata。 */
export async function prepareMarkdownDocumentReferences(input: {
  readonly port: MarkdownDocumentReferencesPort;
  readonly readerId: string; readonly sourceDocumentId: string; readonly sourceKey: string;
  readonly existingContent: MarkdownDocJson; readonly pendings: readonly MarkdownPendingRevisionLike[];
  readonly targetText: string; readonly pendingMetaByMarkdown: ReadonlyMap<string, PendingRevisionMetadata>;
}) {
  const planned = await planMarkdownBlocks(input.targetText);
  if (!planned.docJson) return { targetText: input.targetText, pendingMetaByMarkdown: input.pendingMetaByMarkdown, bindings: [], pendingMetaByTargetIndex: new Map<number, PendingRevisionMetadata>() };
  const admitted = input.port.admit({ ...input, content: JsonValueSchema.parse(planned.docJson), existingContent: referenceBaselineContent(input.existingContent, input.pendings) });
  // Projection 只替换本次准入的 atom，保留其余 root/citation/annotation 结构。
  const document = JsonValueSchema.parse(admitted.content);
  const parsed = parseMarkdownDocJson(document);
  const citations = admitDocumentCitations(parsed);
  const projectInlineNode = (node: { readonly type: string; readonly attrs: Readonly<Record<string, unknown>> }) => node.type === 'documentReference' ? projectTag(admitted.bindings, node.attrs) : node.type === 'citationNode' && typeof node.attrs['citationId'] === 'string' ? citations.getBodyTokenForCitationId(node.attrs['citationId']) : null;
  const blocks = flattenMarkdownDocumentBlocks(parsed, { includeAnnotations: false, projectInlineNode });
  const metadata = new Map<number, PendingRevisionMetadata>();
  for (let index = 0; index < blocks.length; index += 1) {
    const root = parsed.content[index];
    const ids = new Set(collectMarkdownDocumentReferences(root).map(reference => reference.referenceId));
    const bindings = admitted.bindings.filter(binding => ids.has(binding.referenceId));
    metadata.set(index, { ...input.pendingMetaByMarkdown.get(planned.bodyBlocks[index]), ...(bindings.length ? { document_reference_bindings: bindings } : {}) });
  }
  return { targetText: serializeMarkdownFileWriteTarget({ document: parsed, annotationComments: planned.annotationComments, projectBody: markdown => markdown, projectInlineNode }), pendingMetaByMarkdown: input.pendingMetaByMarkdown, pendingMetaByTargetIndex: metadata, bindings: admitted.bindings };
}
