import { PositionUtils } from '../../../extensions/position/PositionUtils'
import { useUIStore } from '../../../../../shared/stores/ui'
import { pickEmbedAndInsertImage } from '../../../blocks/ImageBlock/orchestration/embedAndInsertImage'
import { createChartSlashItems } from '../../../blocks/ChartBlock/menu/chartSlashItems'

/**
 * 斜杠菜单与 Markdown 命令条“更多插入”共用的唯一条目清单。
 * 每项 command({ editor, range }) 先删去 range（斜杠触发文本；从命令条调用时是光标处的空范围）再执行。
 * 新增插入项只改这里，两个入口同时生效。
 *
 * @param {(key: string, params?: Record<string, unknown>) => string} editorMessage
 */
export function createSlashMenuItems(editorMessage) {
  const convertToGroup = editorMessage('editor.slash.group.convertTo');
  const insertGroup = editorMessage('editor.slash.group.insert');
  const chartGroup = editorMessage('editor.chart.slash.group');
  const aiGroup = editorMessage('editor.slash.group.ai');

  const items = [
    // --- 转换为 --- 
    { id: 'heading1', title: editorMessage('editor.slash.item.heading1'), aliases: ['一级标题', 'h1'], group: convertToGroup, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('headingBlock', { level: 1 }).run() },
    { id: 'heading2', title: editorMessage('editor.slash.item.heading2'), aliases: ['二级标题', 'h2'], group: convertToGroup, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('headingBlock', { level: 2 }).run() },
    // { title: '三级标题', group: '转换为', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('headingBlock', { level: 3 }).run() }, // 更多标题
    { id: 'bulletList', title: editorMessage('editor.slash.item.bulletList'), aliases: ['无序列表', 'bullet'], group: convertToGroup, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).convertToListItem('bullet').run() },
    // 参考 MenuBar：有序列表也是一个“块级结构”，这里用 convertToListItem('ordered') 进行转换
    { id: 'orderedList', title: editorMessage('editor.slash.item.orderedList'), aliases: ['有序列表', 'ordered'], group: convertToGroup, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).convertToListItem('ordered').run() },
    // { title: '有序列表', group: '转换为', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
    { id: 'quoteBlock', title: editorMessage('editor.slash.item.quoteBlock'), aliases: ['引用块', 'quote'], group: convertToGroup, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).convertToQuoteBlock().run() },
    { id: 'codeBlock', title: editorMessage('editor.slash.item.codeBlock'), aliases: ['代码块', 'code'], group: convertToGroup, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCodeBlock().run() },
    {
      id: 'latexBlock', title: editorMessage('editor.slash.item.latexBlock'),
      aliases: ['LaTeX 公式', 'latex'],
      group: convertToGroup,
      command: ({ editor, range }) => {
        // 1. Delete the trigger character
        // 2. Call the conversion command
        editor.chain().focus().deleteRange(range).convertToLatexBlock().run();
      }
    },
    {
      id: 'horizontalRule', title: editorMessage('editor.slash.item.horizontalRule'),
      aliases: ['水平分割线', 'divider', 'hr'],
      group: convertToGroup,
      command: ({ editor, range }) => {
        editor.chain().focus().executeInsertHorizontalRuleBeforeAndConvertNext({ range }).run();
      }
    },
    // --- 插入 ---（参考 MenuBar 的“Insertions”）
    {
      id: 'tableBlock', title: editorMessage('editor.slash.item.tableBlock'),
      aliases: ['表格块', 'table'],
      group: insertGroup,
      command: ({ editor, range }) => {
        // SlashMenu 场景下没有表格尺寸选择器：先给一个合理默认值（3x3，带表头）
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run();
      }
    },
    {
      id: 'imageBlock', title: editorMessage('editor.slash.item.imageBlock'),
      aliases: ['图片块', 'image'],
      group: insertGroup,
      command: async ({ editor, range }) => {
        // 先删除触发符与 query，再打开系统图片选择对话框
        editor.chain().focus().deleteRange(range).run();

        await pickEmbedAndInsertImage({
          editor,
          dialogTitle: editorMessage('editor.slash.imageDialog.title'),
          imageFilterName: editorMessage('editor.slash.imageDialog.filterName'),
          insertedMessageKey: 'editor.slash.toast.imageInserted',
          unavailableMessageKey: 'editor.slash.toast.imageDialogUnavailable',
          failedMessageKey: 'editor.slash.toast.imageFlowFailed',
        });
      }
    },

    // --- 图表 --- 八种图表各一项，选择后插入示例图表并打开源码面板
    ...createChartSlashItems(editorMessage, chartGroup),

    // AI 类
    { 
      id: 'aiWriting', title: editorMessage('editor.slash.item.aiWriting'),
      aliases: ['AI 写作', 'ai'],
      group: aiGroup,
      command: ({ editor, range }) => {
        // 删除斜杠触发符
        editor.chain().focus().deleteRange(range).run();
        
        // 获取 UI Store
        const uiStore = useUIStore();
        
        // 获取当前光标位置（删除斜杠后）
        const { from } = editor.state.selection;
        
        // 获取位置工具并获取块信息（参考 AiInteraction.js 实现）
        const posUtils = new PositionUtils(editor);
        const blockInfo = posUtils.getBlockInfoFromPos(from);
        
        // 获取 rootBlock ID
        const rootBlockId = blockInfo?.rootBlock?.node.attrs.id;
        
        if (!rootBlockId) {
          console.error('[SlashMenu AI写作] 无法获取 RootBlock ID');
          return;
        }
        
        // 获取块元素并计算位置
        const blockElement = document.querySelector(`.root-block-outer[data-id="${rootBlockId}"]`);
        if (!blockElement) {
          console.error(`[SlashMenu AI写作] 无法找到 ID 为 ${rootBlockId} 的块元素`);
          return;
        }
        
        const blockRect = blockElement.getBoundingClientRect();
        const position = {
          top: blockRect.bottom + 5,
        };
        
        // 显示 AI 写作输入框
        uiStore.showAiPrompt({
          position,
          targetBlockId: rootBlockId,
          triggerPos: from,
        });
      }
    },

    // 插入引用（Phase 2 新增）
    {
      id: 'citation', title: editorMessage('editor.slash.item.citation'),
      aliases: ['cite', 'citation', '引用', 'yinyong'],  // 支持多种匹配关键词
      group: insertGroup,
      command: async ({ editor, range }) => {
        // 删除斜杠触发符
        editor.chain().focus().deleteRange(range).run();
        
        // 动态导入 Citation 面板 store，避免循环依赖
        const { useCitationPanelStore } = await import('../../citation/store/useCitationPanelStore');
        const citationStore = useCitationPanelStore();
        
        // 打开 Citation 面板
        citationStore.open('kb');
      }
    },
  ];

  return { items, groupOrder: [convertToGroup, insertGroup, chartGroup, aiGroup] };
}
