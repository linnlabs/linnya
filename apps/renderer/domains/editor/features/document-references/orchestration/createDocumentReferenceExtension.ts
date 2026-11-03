import { DocumentReferenceNode } from '@linnya/markdown-document-core';
import Suggestion from '@tiptap/suggestion';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { DocumentReferenceCandidate } from '@app/schemas';
import type { DocumentReferenceUiPort } from '../definitions/documentReferenceUi';
import { createDocumentReferenceUiPort } from '../adapters/createDocumentReferenceUiPort';
import { formatDocumentReferenceMarkdown, readDocumentReferenceAttrs } from '../functions/documentReferenceMarkdown';
import { createDocumentReferenceNodeView } from '../ui/createDocumentReferenceNodeView';
import { createDocumentReferenceSuggestionView } from '../ui/createDocumentReferenceSuggestionView';
import '@linnya/markdown-document-core/style.css';
import '../ui/documentReferences.css';

const suggestionKey = new PluginKey('documentReferenceSuggestion');
function remapCopiedNode(node: ProseMirrorNode): ProseMirrorNode {
  if (node.type.name === 'documentReference') return node.type.create({ ...node.attrs, referenceId: crypto.randomUUID() }, null, node.marks);
  if (node.isLeaf) return node;
  const children: ProseMirrorNode[] = []; node.content.forEach(child => children.push(remapCopiedNode(child)));
  return node.copy(Fragment.fromArray(children));
}
export function createDocumentReferenceExtension(port: DocumentReferenceUiPort = createDocumentReferenceUiPort()) {
  return DocumentReferenceNode.extend({
    renderText({ node }) { const presentation = port.readCached(readDocumentReferenceAttrs(node.attrs).documentId); return presentation ? formatDocumentReferenceMarkdown(presentation) : '文档'; },
    renderMarkdown(node) { const attrs = readDocumentReferenceAttrs(node.attrs); const presentation = port.readCached(attrs.documentId); if (!presentation) throw new Error('document_reference_projection_required'); return formatDocumentReferenceMarkdown(presentation); },
    onDestroy() { port.dispose(); },
    addNodeView() { return ({ node }) => { const attrs = readDocumentReferenceAttrs(node.attrs); return createDocumentReferenceNodeView(attrs.documentId, attrs.referenceId, port); }; },
    addProseMirrorPlugins() {
      return [
        new Plugin({ props: { transformPasted(slice) { const children: ProseMirrorNode[] = []; slice.content.forEach(node => children.push(remapCopiedNode(node))); return new Slice(Fragment.fromArray(children), slice.openStart, slice.openEnd); } } }),
        Suggestion<DocumentReferenceCandidate>({
          editor: this.editor, pluginKey: suggestionKey, char: '@', allowedPrefixes: [' ', '\n', '\t'], startOfLine: false,
          allow: ({ state, range }) => { const position = state.doc.resolve(range.from); if (!port.getProjectId()) return false; for (let depth = position.depth; depth > 0; depth -= 1) { const name = position.node(depth).type.name; if (position.node(depth).type.spec.code || name.toLowerCase().includes('latex')) return false; } return true; },
          items: async ({ query }) => [...await port.query(query)],
          command: ({ editor, range, props }) => { editor.chain().focus().insertContentAt(range, [{ type: 'documentReference', attrs: { documentId: props.documentId, referenceId: crypto.randomUUID() } }, { type: 'text', text: ' ' }]).run(); },
          render: createDocumentReferenceSuggestionView,
        }),
      ];
    },
  });
}
