// src/renderer/extensions/inline/InlineLatexNode.js
import { Node, mergeAttributes, InputRule } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import InlineLatexView from './ui/InlineLatexView.vue' // Adjust path if needed
import { TextSelection } from 'prosemirror-state'
import { generateBlockId } from '../../../../shared/utils/idUtils'
import { NodeSelection } from 'prosemirror-state'
import { useLatexEditorStore } from './store/latexEditor'

// 输入规则: Matches $...$
// 捕获美元符号之间的内容
// 避免匹配单个 $ 或 $$，且不匹配 $$...$$
const inlineLatexInputRule = new InputRule({
  find: /(?<!\$)\$([^\$]+?)\$(?!\$)/,
  handler: ({ state, range, match }) => {
    const { tr } = state
    const [fullMatch, latexSource] = match

    const start = range.from
    const end = range.to

    const newNodeId = generateBlockId();

    tr.replaceWith(start, end, state.schema.nodes.inlineLatex.create({ id: newNodeId, latexSource }))

    const posAfter = start + 1;
    tr.setSelection(TextSelection.create(tr.doc, posAfter));
  },
})

export const InlineLatexNode = Node.create({
  name: 'inlineLatex',

  group: 'inline', // Belongs to the inline group
  inline: true,    // It's an inline node
  atom: true,      // Treat as a single unit, not editable directly in flow
  selectable: true,// Can be selected as a whole
  draggable: true,  // Can be dragged

  addAttributes() {
    return {
      latexSource: {
        default: '',
        parseHTML: element => element.getAttribute('data-latex-source'),
        renderHTML: attributes => {
          if (!attributes.latexSource) {
            return {}
          }
          return {
            'data-latex-source': attributes.latexSource,
          }
        },
      },
      id: {
        default: null,
        parseHTML: element => element.getAttribute('data-node-id'),
        renderHTML: attributes => {
          if (!attributes.id) {
            return {}
          }
          return { 'data-node-id': attributes.id };
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: `span[data-type="${this.name}"][data-node-id]`,
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': this.name }), 0]
  },

  addNodeView() {
    return VueNodeViewRenderer(InlineLatexView)
  },

  addInputRules() {
    return [
      inlineLatexInputRule,
    ]
  },

  addKeyboardShortcuts() {
    return {
      'Space': () => {
        const { state, view } = this.editor;
        const { selection } = state;

        if (selection instanceof NodeSelection && selection.node.type.name === this.name) {
          const node = selection.node;
          const nodeId = node.attrs.id;
          const latexSource = node.attrs.latexSource;
          const domNode = view.nodeDOM(selection.from);

          if (!nodeId) {
             console.error('[InlineLatexNode Shortcut] Cannot open panel: Node ID missing.');
             return false;
          }
          if (!domNode || !(domNode instanceof Element)) {
              console.error('[InlineLatexNode Shortcut] Cannot open panel: DOM node not found or invalid.', domNode);
              return false;
          }

          try {
              const latexStore = useLatexEditorStore(); 
              latexStore.showPanel(
                  nodeId,
                  latexSource,
                  domNode,
                  this.editor
              );
              return true;
          } catch (error) {
               console.error('[InlineLatexNode Shortcut] Error accessing or using LaTeX store:', error);
               return false;
          }
        }

        return false;
      },
    };
  },
})

export default InlineLatexNode 