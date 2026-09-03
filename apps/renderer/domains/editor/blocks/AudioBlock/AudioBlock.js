// src/renderer/features/AudioBlock/AudioBlock.js

import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { generateBlockId } from '../../../../shared/utils/idUtils'
import AudioBlockView from './ui/AudioBlockView.vue'
import { resolveCurrentEditorMessage } from '../../functions/resolveCurrentEditorMessage'
import { resolveAudioBlockRenderPlaceholder } from './functions/audioBlockPresentation'

export const AudioBlock = Node.create({
  name: 'audioBlock',

  atom: true, // 原子节点，其内容不由ProseMirror直接管理
  selectable: true, // 可以被选中
  draggable: false, // 不允许拖拽排序

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'audio-block-outer', // 和其他块保持一致的外部类名
      },
    }
  },

  addAttributes() {
    return {
      id: {
        default: () => generateBlockId(),
        parseHTML: element => element.getAttribute('data-block-id') || generateBlockId(),
        renderHTML: attributes => ({ 'data-block-id': attributes.id }),
      },
      blockType: {
        default: 'audio',
        parseHTML: element => element.getAttribute('data-block-type') || 'audio',
        renderHTML: attributes => ({ 'data-block-type': attributes.blockType }),
      },
      // 用于存储音频文件的相对路径或唯一标识符
      src: {
        default: null,
        parseHTML: element => element.getAttribute('data-src'),
        renderHTML: attributes => attributes.src ? { 'data-src': attributes.src } : {},
      },
      // 录音时长（秒）
      duration: {
        default: 0,
        parseHTML: element => {
          const duration = element.getAttribute('data-duration');
          return duration ? parseFloat(duration) : 0;
        },
        renderHTML: attributes => attributes.duration ? { 'data-duration': attributes.duration } : {},
      },
      // 音频的MIME类型，例如 'audio/webm' 或 'audio/wav'
      mimeType: {
        default: null,
        parseHTML: element => element.getAttribute('data-mime-type'),
        renderHTML: attributes => attributes.mimeType ? { 'data-mime-type': attributes.mimeType } : {},
      },
      // 录制时的时间戳 (Date.now())
      recordedAt: {
        default: null,
        parseHTML: element => {
          const timestamp = element.getAttribute('data-recorded-at');
          return timestamp ? parseInt(timestamp, 10) : null;
        },
        renderHTML: attributes => attributes.recordedAt ? { 'data-recorded-at': attributes.recordedAt } : {},
      },
      // ++ 新增：标记录音是否已终止且不可再录制 ++
      isFinalized: {
        default: false,
        parseHTML: element => {
          const finalized = element.getAttribute('data-is-finalized');
          return finalized === 'true';
        },
        renderHTML: attributes => attributes.isFinalized ? { 'data-is-finalized': 'true' } : {},
      },
      // ++ 新增：标记 src 是否为临时的 blob URL ++
      isTempSrc: {
        default: false,
        parseHTML: element => element.getAttribute('data-is-temp-src') === 'true',
        renderHTML: attributes => attributes.isTempSrc ? { 'data-is-temp-src': 'true' } : {},
      },
      // 录音落盘失败时只持久化失败态，绝不把会话内 blob: 写入文档。
      saveStatus: {
        default: null,
        parseHTML: element => element.getAttribute('data-save-status') === 'failed' ? 'failed' : null,
        renderHTML: attributes => attributes.saveStatus ? { 'data-save-status': attributes.saveStatus } : {},
      },
      // -- [REMOVED] 内容面板数据不再存储于节点属性 --
    }
  },

  // renderHTML 定义了当节点被非NodeView渲染时（例如导出为HTML）的结构
  // 对于使用NodeView的场景，实际渲染由AudioBlockView.vue控制
  renderHTML({ HTMLAttributes, node }) {
    const outer = document.createElement('div')
    mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-node-type': 'audioBlockOuter' }, outer)

    const inner = document.createElement('div')
    inner.className = 'audio-block editor-block' // 与其他块一致的内部类名
    inner.setAttribute('data-block-id', node.attrs.id)
    inner.setAttribute('data-block-type', node.attrs.blockType)
    if (node.attrs.src) {
      inner.setAttribute('data-src', node.attrs.src)
    }
    if (node.attrs.duration) {
      inner.setAttribute('data-duration', String(node.attrs.duration))
    }
    if (node.attrs.mimeType) {
      inner.setAttribute('data-mime-type', node.attrs.mimeType)
    }
    if (node.attrs.recordedAt) {
      inner.setAttribute('data-recorded-at', String(node.attrs.recordedAt))
    }
    // ++ 渲染 isFinalized 属性 ++
    if (node.attrs.isFinalized) {
      inner.setAttribute('data-is-finalized', 'true');
    }
    // ++ 渲染 isTempSrc 属性 ++
    if (node.attrs.isTempSrc) {
      inner.setAttribute('data-is-temp-src', 'true');
    }
    if (node.attrs.saveStatus) {
      inner.setAttribute('data-save-status', node.attrs.saveStatus);
    }
    
    // -- [REMOVED] 不再渲染内容面板属性 --

    // 简单的占位符内容，实际的播放器等UI在NodeView中实现
    const placeholder = document.createElement('p');
    placeholder.textContent = resolveAudioBlockRenderPlaceholder(node.attrs.src, resolveCurrentEditorMessage);
    inner.appendChild(placeholder);
    
    outer.appendChild(inner)
    
    return {
      dom: outer,
      contentDOM: undefined, // 原子节点没有 contentDOM
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-node-type="audioBlockOuter"] div[data-block-type="audio"]', // 匹配我们 renderHTML 的结构
      },
    ]
  },

  addCommands() {
    return {
      insertAudioBlock: (options = {}) => ({ commands, editor }) => {

        const { selection } = editor.state;
        const $from = selection.$from;
        let insertPos = null;

        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if (node.type.name === 'rootBlock') {
            insertPos = $from.after(d); // 在这个 RootBlock 之后插入
            break;
          }
        }

        if (insertPos === null) {
          insertPos = editor.state.doc.content.size;
        }
        
        return commands.insertContentAt(insertPos, {
          type: 'rootBlock', // 外部包裹一个 RootBlock
          content: [{
            type: this.name, // 内部是 audioBlock (this.name)
            attrs: {
              recordedAt: Date.now(),
              isFinalized: false, // ++ 新录音块默认不是 finalized ++
              isTempSrc: false, // ++ 新录音块默认 src 不是临时的 blob URL ++
              saveStatus: null,
              ...options.attrs,
            },
          }],
        });
      },
      updateAudioBlockAttributes: (attributes) => ({ commands }) => {
        return commands.updateAttributes(this.name, attributes)
      },
    }
  },

  addNodeView() {
    return VueNodeViewRenderer(AudioBlockView)
  },
})

export default AudioBlock
