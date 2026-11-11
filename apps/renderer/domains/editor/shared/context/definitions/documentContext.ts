/** 块上下文的范围和裁剪合同；具体功能的默认值由调用方拥有。 */
export interface BlockContextOptions {
  blockId?: string | null;
  position?: number | null;
  blocksBefore?: number;
  blocksAfter?: number;
  includeCurrentBlock?: boolean;
  separateCurrentBlock?: boolean;
  charsLimitBefore?: number | null;
  charsLimitAfter?: number | null;
  charsLimitCurrent?: number | null;
}
export interface DocumentTextContext {
  contextBefore: string | null;
  contextAfter: string | null;
  currentBlockContent?: string | null;
}
