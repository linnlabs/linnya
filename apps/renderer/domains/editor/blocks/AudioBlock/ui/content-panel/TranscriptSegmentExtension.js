/**
 * TranscriptSegment Tiptap Extension
 * 为转录文本提供自定义节点：包含时间戳、原文、翻译的段落
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import TranscriptSegmentView from './TranscriptSegmentView.vue'

export const TranscriptSegment = Node.create({
  name: 'transcriptSegment',

  group: 'block',

  content: 'block+',

  defining: true,
  
  isolating: true,

  addAttributes() {
    return {
      // 段落 ID
      id: {
        default: null,
        parseHTML: element => element.getAttribute('data-segment-id'),
        renderHTML: attributes => ({
          'data-segment-id': attributes.id,
        }),
      },
      // 时间戳文本 (例如 "00:01:23")
      timestamp: {
        default: '',
        parseHTML: element => element.getAttribute('data-timestamp'),
        renderHTML: attributes => ({
          'data-timestamp': attributes.timestamp,
        }),
      },
      // 开始时间（秒）
      startTime: {
        default: 0,
        parseHTML: element => parseFloat(element.getAttribute('data-start-time')) || 0,
        renderHTML: attributes => ({
          'data-start-time': attributes.startTime,
        }),
      },
      // 翻译列是否可见（由全局状态控制，但存在这里方便扩展）
      translationVisible: {
        default: false,
        parseHTML: element => element.getAttribute('data-translation-visible') === 'true',
        renderHTML: attributes => ({
          'data-translation-visible': attributes.translationVisible,
        }),
      },
      // 原文列宽度百分比
      textColumnWidth: {
        default: 50,
        parseHTML: element => parseFloat(element.getAttribute('data-text-width')) || 50,
        renderHTML: attributes => ({
          'data-text-width': attributes.textColumnWidth,
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="transcript-segment"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'transcript-segment' }), 0]
  },

  addNodeView() {
    return VueNodeViewRenderer(TranscriptSegmentView)
  },
})

/**
 * TranscriptText - 原文块
 */
export const TranscriptText = Node.create({
  name: 'transcriptText',

  group: 'block',

  content: 'inline*',

  defining: true,

  parseHTML() {
    return [
      {
        tag: 'div[data-type="transcript-text"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'transcript-text' }), 0]
  },
})

/**
 * TranscriptTranslation - 翻译块（可选）
 */
export const TranscriptTranslation = Node.create({
  name: 'transcriptTranslation',

  group: 'block',

  content: 'inline*',

  defining: true,

  parseHTML() {
    return [
      {
        tag: 'div[data-type="transcript-translation"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'transcript-translation' }), 0]
  },
})

/**
 * TranscriptDocument - 转录文档容器
 */
export const TranscriptDocument = Node.create({
  name: 'transcriptDocument',

  topNode: true,

  content: 'transcriptSegment*',
})

