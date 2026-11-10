// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { DocumentReferenceMarkdownBinding } from '@app/schemas';
import { workspaceMarkdownSchemaLite } from 'src/domains/markdown';
import { resolvePendingMarkdownForSingleBlock } from '../pendingRevisionHelpers';
import { buildInsertedNodesForRichSegment } from '../../diffApplier';
import { linearizeNode } from '../../linearizeBlock';
import { computeRichDiff } from '../../richDiff';

vi.mock('../../../../../services/markdownRuntime/parser', async () => {
  const { parseMarkdownToBlocksInNode } = await import('src/domains/markdown/features/normalization');
  return { parseMarkdownToBlockEvents: parseMarkdownToBlocksInNode };
});
const bindings: DocumentReferenceMarkdownBinding[] = [{ referenceId: 'ref-a', targetDocumentId: 'target', path: 'workspace:/Original.md', label: 'Original.md' }];
const editor = { state: { schema: workspaceMarkdownSchemaLite } };
describe('document reference pending projection through production parser and revision pipeline', () => {
  it('hydrates a proposed link into a stable atom and preserves the same identity through diff insertion', async () => {
    const resolution = await resolvePendingMarkdownForSingleBlock(editor, 'See [Original.md](workspace:/Original.md) now', { operation: 'test', documentReferenceBindings: bindings });
    expect(resolution.kind).toBe('content-block'); if (resolution.kind !== 'content-block') throw new Error('Expected inline proposal');
    const atom = resolution.spans.find(span => span.inlineAtom?.type === 'documentReference');
    expect(atom?.inlineAtom).toMatchObject({ documentId: 'target', referenceId: 'ref-a' });
    if (!atom) throw new Error('No proposed atom');
    const nodes = buildInsertedNodesForRichSegment(workspaceMarkdownSchemaLite, atom);
    expect(nodes[0].toJSON()).toMatchObject({ type: 'documentReference', attrs: { documentId: 'target', referenceId: 'ref-a' } });
    const baseline = workspaceMarkdownSchemaLite.nodes.baseBlock.create({ id: 'block-12345678' }, nodes);
    const projected = linearizeNode(baseline);
    expect(computeRichDiff(projected.spans, [atom]).stats).toMatchObject({ insertCount: 0, deleteCount: 0 });
  });
  it('assigns distinct stored appearance IDs across repeated links in separate table cells and protects code examples', async () => {
    const resolution = await resolvePendingMarkdownForSingleBlock(editor, '| One | Two |\n| --- | --- |\n| [Original.md](workspace:/Original.md) | [Original.md](workspace:/Original.md) |', { operation: 'test', documentReferenceBindings: [...bindings, { ...bindings[0], referenceId: 'ref-b' }] });
    if (resolution.kind !== 'table-block') throw new Error('Expected table proposal');
    const ids: string[] = []; for (const row of resolution.tableRowsResult.rows) row.descendants(node => { if (node.type.name === 'documentReference') ids.push(String(node.attrs.referenceId)); });
    expect(ids).toEqual(['ref-a', 'ref-b']);
    const code = await resolvePendingMarkdownForSingleBlock(editor, '`[Original.md](workspace:/Original.md)`', { operation: 'test', documentReferenceBindings: bindings });
    if (code.kind !== 'content-block') throw new Error('Expected code span');
    expect(code.spans.some(span => span.inlineAtom?.type === 'documentReference')).toBe(false);
  });
});
