/**
 * 转录数据工具
 * 创建示例转录文档
 */

/**
 * 将 ASR segments 转换为 ProseMirror JSON 文档
 * @param {Array} segments - ASR 返回的 segments 数组
 * @returns {Object} ProseMirror JSON 文档
 */
export function segmentsToProseMirrorDoc(segments) {
  if (!segments || segments.length === 0) {
    return {
      type: 'transcriptDocument',
      content: []
    }
  }

  const content = segments.map((segment, index) => {
    const { text, start, startTime, translation } = segment
    const actualStartTime = start !== undefined ? start : startTime
    
    // 格式化时间戳
    const timestamp = formatTimestamp(actualStartTime || 0)
    
    // 构建 segment 节点
    const segmentNode = {
      type: 'transcriptSegment',
      attrs: {
        id: `segment-${index}`,
        timestamp: timestamp,
        startTime: actualStartTime || 0,
        translationVisible: false,
        textColumnWidth: 50
      },
      content: [
        {
          type: 'transcriptText',
          content: text ? [{ type: 'text', text }] : []
        }
      ]
    }
    
    // 如果有翻译，添加翻译节点
    if (translation) {
      segmentNode.content.push({
        type: 'transcriptTranslation',
        content: [{ type: 'text', text: translation }]
      })
    }
    
    return segmentNode
  })

  return {
    type: 'transcriptDocument',
    content
  }
}

/**
 * 将 ProseMirror JSON 文档转换为 segments 数组
 * @param {Object} proseMirrorDoc - ProseMirror JSON 文档
 * @returns {Array} segments 数组
 */
export function proseMirrorDocToSegments(proseMirrorDoc) {
  if (!proseMirrorDoc || !proseMirrorDoc.content) {
    return []
  }

  return proseMirrorDoc.content.map((segmentNode) => {
    const { attrs, content } = segmentNode
    
    // 提取原文
    const textNode = content.find(node => node.type === 'transcriptText')
    const text = textNode?.content?.[0]?.text || ''
    
    // 提取翻译（如果存在）
    const translationNode = content.find(node => node.type === 'transcriptTranslation')
    const translation = translationNode?.content?.[0]?.text || null
    
    return {
      text,
      start: attrs.startTime,
      end: attrs.startTime, // ASR 服务通常不返回 end，这里简化处理
      timestamp: attrs.timestamp,
      translation
    }
  })
}

/**
 * 格式化时间戳
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间戳 HH:MM:SS
 */
function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/**
 * 为示例数据创建默认文档
 * @returns {Object} ProseMirror JSON 文档
 */
export function createExampleTranscriptDoc() {
  return {
    type: 'transcriptDocument',
    content: [
      {
        type: 'transcriptSegment',
        attrs: {
          id: 'example-1',
          timestamp: '00:00:00',
          startTime: 0,
          translationVisible: false,
          textColumnWidth: 50
        },
        content: [
          {
            type: 'transcriptText',
            content: [
              { type: 'text', text: 'This is the first example transcript segment.' }
            ]
          },
          {
            type: 'transcriptTranslation',
            content: [
              { type: 'text', text: 'This is the first example text, showing the display of transcription content.' }
            ]
          }
        ]
      },
      {
        type: 'transcriptSegment',
        attrs: {
          id: 'example-2',
          timestamp: '00:00:15',
          startTime: 15,
          translationVisible: false,
          textColumnWidth: 50
        },
        content: [
          {
            type: 'transcriptText',
            content: [
              { type: 'text', text: 'Click a timestamp to jump to the matching audio position.' }
            ]
          },
          {
            type: 'transcriptTranslation',
            content: [
              { type: 'text', text: 'This is the second example text, you can click the timestamp to jump to the corresponding audio position.' }
            ]
          }
        ]
      },
      {
        type: 'transcriptSegment',
        attrs: {
          id: 'example-3',
          timestamp: '00:00:32',
          startTime: 32,
          translationVisible: false,
          textColumnWidth: 50
        },
        content: [
          {
            type: 'transcriptText',
            content: [
              { type: 'text', text: 'Timestamps stay on the left, and recognized speech appears on the right.' }
            ]
          },
          {
            type: 'transcriptTranslation',
            content: [
              { type: 'text', text: 'This is the third example text, with timestamp on the left and corresponding speech recognition text on the right.' }
            ]
          }
        ]
      },
      {
        type: 'transcriptSegment',
        attrs: {
          id: 'example-4',
          timestamp: '00:00:48',
          startTime: 48,
          translationVisible: false,
          textColumnWidth: 50
        },
        content: [
          {
            type: 'transcriptText',
            content: [
              { type: 'text', text: 'Real transcription results will replace this sample content.' }
            ]
          },
          {
            type: 'transcriptTranslation',
            content: [
              { type: 'text', text: 'In actual use, these contents will be replaced with real transcription results.' }
            ]
          }
        ]
      }
    ]
  }
}
