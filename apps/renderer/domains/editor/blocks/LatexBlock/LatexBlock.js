// src/renderer/extensions/blocks/LatexBlock.js
import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { generateBlockId } from '../../../../shared/utils/idUtils'
import LatexBlockView from './ui/LatexBlockView.vue' // Corrected path
import { STREAMING_CHUNK_PROCESSORS_KEY } from '../../shared/constants/editorStorageKeys';
// 假设这个命令会被创建或修改，或者 insertLatexBlockWithContent 已能满足新需求
// 我们暂时用现有的 insertLatexBlockWithContent，并认为它能处理好后续块和光标
import { insertLatexBlockWithContent } from './commands/LatexCommands';

export const LatexBlock = Node.create({
  name: 'latexBlock',

  group: 'block', // Belongs to the block group

  // Ensure it is treated as a self-contained block
  atom: true,
  draggable: true,
  isolating: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: element => element.getAttribute('data-id'),
        renderHTML: attributes => ({
          'data-id': attributes.id,
        }),
      },
      blockType: {
        default: 'latex',
        parseHTML: element => element.getAttribute('data-block-type'),
        renderHTML: attributes => ({
          'data-block-type': attributes.blockType,
        }),
      },
      latexSource: {
        default: 'E = mc^2', // Default example source
        parseHTML: element => element.querySelector('pre > code')?.textContent || '',
        renderHTML: attributes => {
          // We store the source in a non-rendered element for parsing
          return {}; // Rendered visually by the Node View
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[data-type="${this.name}"]`,
        // Optional: Add getAttrs function if needed for complex parsing
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    // Render a container div. The actual content (source editor + rendered view)
    // will be handled by the Vue Node View.
    // We include a <pre><code> block mainly for copying/pasting and simple HTML representation
    // if the Node View fails or isn't used (e.g., during serialization for storage).
    const dom = document.createElement('div');
    mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, dom);
    dom.setAttribute('data-type', this.name);

    // Hidden PRE block for source storage / copy-paste compatibility
    const pre = document.createElement('pre');
    pre.style.display = 'none'; // Hide it visually
    const code = document.createElement('code');
    code.textContent = node.attrs.latexSource;
    pre.appendChild(code);
    dom.appendChild(pre);

    // The VueNodeViewRenderer will attach the actual interactive component here
    return dom;
  },

  addNodeView() {
    return VueNodeViewRenderer(LatexBlockView);
  },

  onCreate() {
    // Ensure the registry for chunk processors exists
    // It's good practice to check if editor and editor.storage exist, though in onCreate they should.
    if (this.editor && this.editor.storage) {
        this.editor.storage[STREAMING_CHUNK_PROCESSORS_KEY] =
            this.editor.storage[STREAMING_CHUNK_PROCESSORS_KEY] || [];

        // Define the processor function
        // Storing on 'this' to remove it in onDestroy
        // New signature: (parsedJson, editor, pluginState, updatePluginStateCallback, originalJsonString)
        this.latexChunkProcessor = (parsedJson, editor, pluginState, updatePluginState, originalJsonString) => {
            const originalStringPreview = typeof originalJsonString === 'string' ? originalJsonString.substring(0,70) : '[Not a string or undefined]';
            // console.log('[LatexChunkProcessor] Received pre-parsed JSON. Type:', parsedJson?.type, 'Content preview:', parsedJson?.content?.substring(0,50), 'Original string preview:', originalStringPreview);
            
            if (parsedJson && parsedJson.type === 'latex_complete' && typeof parsedJson.content === 'string') {
                try {
                    const success = insertLatexBlockWithContent(parsedJson.content)({ editor });

                    if (success) {
                        return true; 
                    } else {
                        return false; 
                    }
                } catch (error) {
                    return false; // Indicate failure, let queueProcessor handle fallback
                }
            } else {
                // Only log if it was expected to be a latex_complete but wasn't, to reduce noise for other JSON types or non-string content.
                if (parsedJson && parsedJson.type) { // If type exists but is not latex_complete, or content is not string
                } else if (!parsedJson) {
                    // This case (parsedJson is null/undefined) should ideally be caught by PRE-CALL CHECKS in queueProcessor
                }
                return false; // Not the type this processor handles, or parsedJson is invalid
            }
        };

        // Register the processor
        this.editor.storage[STREAMING_CHUNK_PROCESSORS_KEY].push(this.latexChunkProcessor);
    } else {
    }
  },

  onDestroy() {
    if (this.editor && this.editor.storage && this.editor.storage[STREAMING_CHUNK_PROCESSORS_KEY] && this.latexChunkProcessor) {
        this.editor.storage[STREAMING_CHUNK_PROCESSORS_KEY] =
            this.editor.storage[STREAMING_CHUNK_PROCESSORS_KEY].filter(
                processor => processor !== this.latexChunkProcessor
            );
    }
    this.latexChunkProcessor = null; // Clear the reference
  }

  // Optional: Define commands related to this node if needed
  // addCommands() {
  //   return {
  //     // Example: setLatexSource: attributes => ({ commands }) => { ... }
  //   };
  // },
});

export default LatexBlock; 