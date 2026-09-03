import { Extension } from '@tiptap/core';

export const CommonMarkdownInputRules = Extension.create({
  name: 'commonMarkdownInputRules',

  onCreate() {
    if (!this.editor.storage.markdownBlockRulesRegistry) {
      this.editor.storage.markdownBlockRulesRegistry = { checkers: [] };
    }
  },

  addInputRules() {
    const areRulesDisabled = (state) => {
      const registry = this.editor.storage.markdownBlockRulesRegistry;
      return registry && registry.checkers.some(checker => checker(state));
    };

    return [
      // 标题规则 - 修改为与 HeadingBlock.js 一致
      {
        find: /^(#{1,6})\s$/,
        handler: (props) => {
          if (areRulesDisabled(props.state)) return false;
          const { range, chain } = props;
          const level = props.match[1].length;
          return chain()
            .deleteRange({ from: range.from, to: range.to })
            .convertToHeading(level)
            .run();
        }
      },
      
      // 无序列表规则 - 支持 - 和 * 
      {
        find: /^(-|\*)\s$/,
        handler: (props) => {
          if (areRulesDisabled(props.state)) return false;
          const { range, chain } = props;
          return chain()
            .deleteRange({ from: range.from, to: range.to })
            .convertToListItem('bullet')
            .run();
        }
      },

      // 有序列表规则 - 支持 1. 2. 3. ...（只要输入 “数字 + . + 空格” 即触发）
      // 关键：把用户输入的数字作为 start 传下去，让有序列表能从任意整数起编。
      // 例如：在 baseBlock 段落后输入 “5. ”，本项就会显示为 “5.”，
      // 并以此为新有序段的起点，下一项（Enter 拆出）显示 “6.”。
      {
        find: /^(\d+)\.\s$/,
        handler: (props) => {
          if (areRulesDisabled(props.state)) return false;
          const { range, chain, match } = props;
          const startRaw = parseInt(match[1], 10);
          const start = Number.isFinite(startRaw) && startRaw > 0 ? startRaw : 1;
          return chain()
            .deleteRange({ from: range.from, to: range.to })
            .convertToListItem('ordered', { start })
            .run();
        }
      },
      
      // --- 水平分割线规则 (调用 app 命令版本) ---
      {
        find: /^\s*(---|===|___)\s*$/,
        handler: function(props) { 
          if (areRulesDisabled(props.state)) return false;
          const { range, chain } = props;
          const transactionCompleted = chain()
            .executeInsertHorizontalRuleBeforeAndConvertNext({ range })
            .run();
          return transactionCompleted; 
        }
      },
      
      // 引用块规则 - 当输入 > 空格时
      {
        find: /^>\s$/,
        handler: (props) => {
          if (areRulesDisabled(props.state)) return false;
          const { range, chain } = props;
          return chain()
            .deleteRange({ from: range.from, to: range.to })
            .convertToQuoteBlock()
            .run();
        }
      },
      // 图片规则 (从 MarkdownInputRules.js 迁移)
      {
        find: /!\[([^\]]+)\]\(([^)]+)\)$/,
        handler: ({ state, match, chain }) => {
          if (areRulesDisabled(state)) return false;
          const [fullMatch, alt, src] = match;
          chain()
            .deleteRange({ from: state.selection.from - fullMatch.length, to: state.selection.from })
            .setImage({ src, alt })
            .run();
          return true;
        }
      }
    ];
  }
}); 