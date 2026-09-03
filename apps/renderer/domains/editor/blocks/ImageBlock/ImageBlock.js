import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey, NodeSelection } from 'prosemirror-state'
import { generateBlockId } from '../../../../shared/utils/idUtils'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import ImageBlockView from './ui/ImageBlockView.vue'
import { selectInsertedImageNode } from './imageSelection'
import { resolveCurrentEditorMessage } from '../../functions/resolveCurrentEditorMessage'

/**
 * ImageBlock 扩展
 * 用于在编辑器中插入和显示图片
 */
export const ImageBlock = Node.create({
  name: 'imageBlock',

  // 图片块是原子节点，不包含可编辑内容
  atom: true,

  // 定义特性
  defining: true,
  selectable: true,
  draggable: false,

  // 添加选项
  addOptions() {
    return {
      HTMLAttributes: {
        class: 'image-block',
      },
    }
  },

  // 添加属性
  addAttributes() {
    return {
      // 块的唯一ID
      id: {
        default: () => generateBlockId(),
        parseHTML: (element) => element.getAttribute('data-block-id') || generateBlockId(),
        renderHTML: attributes => ({
          'data-block-id': attributes.id,
        })
      },
      // 块的类型标识
      blockType: {
        default: 'image',
        parseHTML: element => element.getAttribute('data-block-type') || 'image',
        renderHTML: attributes => ({
          'data-block-type': attributes.blockType,
        })
      },
      // 图片源地址
      src: {
        default: '',
        parseHTML: element => {
          // 尝试从内层img元素获取src
          const img = element.querySelector('img');
          return img ? img.getAttribute('src') : element.getAttribute('data-src') || '';
        },
        renderHTML: attributes => ({
          'data-src': attributes.src,
        })
      },
      // 替代文本
      alt: {
        default: '',
        parseHTML: element => {
          const img = element.querySelector('img');
          return img ? img.getAttribute('alt') : element.getAttribute('data-alt') || '';
        },
        renderHTML: attributes => ({
          'data-alt': attributes.alt,
        })
      },
      // 图片标题
      title: {
        default: '',
        parseHTML: element => {
          const img = element.querySelector('img');
          return img ? img.getAttribute('title') : element.getAttribute('data-title') || '';
        },
        renderHTML: attributes => ({
          'data-title': attributes.title,
        })
      },
      // 图片宽度
      width: {
        default: null,
        parseHTML: element => {
          const img = element.querySelector('img');
          return img && img.hasAttribute('width') ? parseInt(img.getAttribute('width'), 10) : null;
        },
        renderHTML: attributes => attributes.width ? { 'data-width': attributes.width } : {}
      },
      // 图片高度
      height: {
        default: null,
        parseHTML: element => {
          const img = element.querySelector('img');
          return img && img.hasAttribute('height') ? parseInt(img.getAttribute('height'), 10) : null;
        },
        renderHTML: attributes => attributes.height ? { 'data-height': attributes.height } : {}
      },
      // 对齐方式
      alignment: {
        default: 'center',
        parseHTML: element => element.getAttribute('data-alignment') || 'center',
        renderHTML: attributes => ({
          'data-alignment': attributes.alignment,
        })
      },
      // 上传时间
      uploadedAt: {
        default: () => Date.now(),
        parseHTML: element => {
          const timestamp = element.getAttribute('data-uploaded-at');
          return timestamp ? parseInt(timestamp, 10) : Date.now();
        },
        renderHTML: attributes => ({
          'data-uploaded-at': attributes.uploadedAt,
        })
      }
    }
  },

  // 定义节点的HTML结构 - 使用两层DOM结构，类似其他块
  renderHTML({ HTMLAttributes, node }) {
    // 创建外层元素
    const outer = document.createElement('div');
    outer.className = 'image-block-outer';
    outer.setAttribute('data-node-type', 'imageBlockOuter');

    // 创建内层元素
    const inner = document.createElement('div');
    inner.className = 'image-block editor-block';
    inner.setAttribute('data-node-type', 'imageBlock');
    inner.setAttribute('data-type', 'image-block');
    inner.setAttribute('data-block-id', node.attrs.id);
    inner.setAttribute('data-block-type', node.attrs.blockType);

    // 设置对齐方式
    if (node.attrs.alignment) {
      inner.setAttribute('data-alignment', node.attrs.alignment);
      inner.classList.add(`align-${node.attrs.alignment}`);
    }

    // 创建图片元素
    if (node.attrs.src) {
      const img = document.createElement('img');
      img.src = node.attrs.src;

      if (node.attrs.alt) img.alt = node.attrs.alt;
      if (node.attrs.title) img.title = node.attrs.title;
      if (node.attrs.width) img.width = node.attrs.width;
      if (node.attrs.height) img.height = node.attrs.height;

      // 设置图片样式
      img.style.maxWidth = '100%';
      img.className = 'image-block-img';

      // 添加图片到内层元素
      inner.appendChild(img);
    } else {
      // 如果没有图片源，显示占位符
      inner.classList.add('empty-image');
      inner.textContent = resolveCurrentEditorMessage('editor.imageBlock.empty');
    }

    // 组装DOM结构
    outer.appendChild(inner);

    return {
      dom: outer,
      contentDOM: null // 原子节点不需要contentDOM
    };
  },

  // 从HTML解析节点
  parseHTML() {
    return [
      {
        tag: 'div[data-node-type="imageBlock"]',
        priority: 51,
      },
      {
        tag: 'div[data-type="image-block"]',
        priority: 51,
      },
      // 也可以直接解析img标签
      {
        tag: 'img',
        getAttrs: (dom) => {
          // 确保不是嵌套在其他结构内的img
          const isStandaloneImage = !dom.parentElement ||
                                    (dom.parentElement.tagName !== 'DIV' &&
                                     !dom.parentElement.hasAttribute('data-node-type'));
          return isStandaloneImage ? {} : false;
        },
        priority: 50,
      }
    ]
  },

  // 添加命令
  addCommands() {
    return {
      // 插入图片块命令
      insertImage: (options = {}) => ({ tr, dispatch, editor }) => {
        const insertFrom = tr.selection.from;

        // 创建图片块节点
        const node = editor.schema.nodes.imageBlock.create({
          src: options.src || '',
          alt: options.alt || '',
          title: options.title || '',
          width: options.width || null,
          height: options.height || null,
          alignment: options.alignment || 'center'
        });

        if (dispatch) {
          tr.replaceSelectionWith(node);
          selectInsertedImageNode(tr, insertFrom);
          tr.scrollIntoView();
        }

        return true;
      },

      // 更新图片属性命令
      updateImage: (options = {}) => ({ tr, dispatch, state }) => {
        const { selection } = state;
        const { from, to } = selection;

        if (!dispatch) return true;

        // 查找选中的图片块
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'imageBlock') {
            const newAttrs = {};

            // 只更新有值的属性
            if (options.src !== undefined) newAttrs.src = options.src;
            if (options.alt !== undefined) newAttrs.alt = options.alt;
            if (options.title !== undefined) newAttrs.title = options.title;
            if (options.width !== undefined) newAttrs.width = options.width;
            if (options.height !== undefined) newAttrs.height = options.height;
            if (options.alignment !== undefined) newAttrs.alignment = options.alignment;

            tr.setNodeMarkup(pos, null, { ...node.attrs, ...newAttrs });
            return false; // 停止遍历
          }
        });

        dispatch(tr);
        return true;
      }
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('imageBlockClickHandler'),
        props: {
          handleClickOn: (view, pos, node, nodePos) => {
            if (node.type.name !== this.name) {
              return false;
            }

            // 检查是否已经选中这个节点
            const currentSelection = view.state.selection;
            if (currentSelection instanceof NodeSelection && currentSelection.from === nodePos) {
              return true;
            }

            // 选中图片块
            const tr = view.state.tr.setSelection(
              NodeSelection.create(view.state.doc, nodePos)
            );

            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(ImageBlockView)
  }
})

export default ImageBlock
