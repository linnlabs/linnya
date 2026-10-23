export interface ChartEditTarget {
  readonly editorSessionId: string;
  readonly blockId: string;
}

export interface ChartEditRequest extends ChartEditTarget {
  /** 刚插入的示例图表：面板提示“数据是示例”。 */
  readonly isSample?: boolean;
  readonly target?: 'source' | 'caption';
}
