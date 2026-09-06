import { TableCell, TableHeader } from '@tiptap/extension-table';

const cellContentSchemaName = 'tableCellContentBlock';

// 扩展TableCell节点，添加对style属性的支持  
export const CustomTableCell = TableCell.extend({
  content: cellContentSchemaName + '+',

  addAttributes() {
    // ⭐️ 关键：确保父类的所有属性（包括 colwidth）都被保留
    const parentAttrs = this.parent?.() || {};
    
    return {
      ...parentAttrs, // 保留父类的所有属性，包括 colwidth
      style: {
        default: null,
        parseHTML: element => element.getAttribute('style'),
        renderHTML: attributes => {
          if (attributes.style) {
            return { style: attributes.style };
          }
          return {};
        },
      }
    };
  },
});

// 扩展TableHeader节点，添加对style属性的支持
export const CustomTableHeader = TableHeader.extend({
  content: cellContentSchemaName + '+',

  addAttributes() {
    // ⭐️ 关键：确保父类的所有属性（包括 colwidth）都被保留
    const parentAttrs = this.parent?.() || {};
    
    return {
      ...parentAttrs, // 保留父类的所有属性，包括 colwidth
      style: {
        default: null,
        parseHTML: element => element.getAttribute('style'),
        renderHTML: attributes => {
          if (attributes.style) {
            return { style: attributes.style };
          }
          return {};
        },
      }
    };
  },
});
