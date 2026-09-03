import { Node, mergeAttributes } from '@tiptap/core';
import { InputRule } from '@tiptap/core';

/**
 * 时间戳节点扩展
 * 将时间戳渲染为可点击的绿色标签
 * 支持快捷输入：输入 @time 自动插入时间戳
 */
export const TimestampNode = Node.create({
  name: 'timestamp',

  group: 'inline',
  
  inline: true,
  
  selectable: true,
  
  atom: true,

  addAttributes() {
    return {
      time: {
        default: 0,
        parseHTML: element => parseFloat(element.getAttribute('data-time')) || 0,
        renderHTML: attributes => {
          return {
            'data-time': attributes.time,
          };
        },
      },
      label: {
        default: '00:00:00',
        parseHTML: element => element.getAttribute('data-label') || '00:00:00',
        renderHTML: attributes => {
          return {
            'data-label': attributes.label,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="timestamp"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        {
          'data-type': 'timestamp',
          'class': 'timestamp-tag',
          'contenteditable': 'false',
        },
        HTMLAttributes
      ),
      node.attrs.label,
    ];
  },

  addNodeView() {
    return ({ node, editor }) => {
      const span = document.createElement('span');
      span.className = 'timestamp-tag';
      span.setAttribute('data-type', 'timestamp');
      span.setAttribute('data-time', node.attrs.time);
      span.setAttribute('data-label', node.attrs.label);
      span.contentEditable = 'false';
      span.textContent = node.attrs.label;
      
      // 添加点击事件处理
      span.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        
        // 触发自定义事件，通知外部组件跳转到对应时间
        const customEvent = new CustomEvent('timestamp-click', {
          detail: {
            time: node.attrs.time,
            label: node.attrs.label,
          },
          bubbles: true,
        });
        span.dispatchEvent(customEvent);
      });
      
      return {
        dom: span,
      };
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /@time$/,
        handler: ({ state, range, match }) => {
          const { tr } = state;
          const start = range.from;
          const end = range.to;

          // 删除匹配的文本 (@time)
          tr.delete(start, end);

          // 获取当前播放时间
          // 注意：这里我们需要从外部传入 getCurrentPlayTime 函数
          const getCurrentPlayTime = this.options.getCurrentPlayTime;
          const currentTime = getCurrentPlayTime ? getCurrentPlayTime() : 0;

          // 格式化时间戳
          const formatTimestamp = (seconds) => {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = Math.floor(seconds % 60);
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
          };

          const timestamp = formatTimestamp(currentTime);

          // 插入时间戳节点
          const node = this.type.create({
            time: currentTime,
            label: timestamp,
          });

          tr.insert(start, node);
          
          // 在时间戳后添加一个空格，方便继续输入
          tr.insertText(' ', start + 1);

          return tr;
        },
      }),
    ];
  },

  addOptions() {
    return {
      getCurrentPlayTime: null, // 将由外部传入
    };
  },
});

