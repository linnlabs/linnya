/** 所有表面（编辑器、只读预览、画布、PDF）的表格元素都带这个 class，共用 `workspace-table.css`。 */
export const WORKSPACE_TABLE_CLASS = 'table-block';

/** 短格：单行、不超过 8em 的文字，内容不断行。编辑器用 decoration、预览与 PDF 在投影时加。 */
export const WORKSPACE_TABLE_COMPACT_CELL_CLASS = 'table-cell--compact';

/**
 * 表格样式预设：table 节点的 `tableStyle` 属性，整张表的呈现事实，归用户所有。
 * 预设只换线、表头底色与行底色；字号、内边距、短格与分级退让与默认样式相同。
 */
export const WORKSPACE_TABLE_STYLES = ['default', 'three-line', 'column-rules', 'grid', 'banded', 'accent-header'] as const;

export type WorkspaceTableStyle = (typeof WORKSPACE_TABLE_STYLES)[number];

export const DEFAULT_WORKSPACE_TABLE_STYLE: WorkspaceTableStyle = 'default';

/** 非默认样式写在 table 元素上；默认样式不写，现有表格的 DOM 与快照不变。 */
export const WORKSPACE_TABLE_STYLE_ATTRIBUTE = 'data-table-style';
