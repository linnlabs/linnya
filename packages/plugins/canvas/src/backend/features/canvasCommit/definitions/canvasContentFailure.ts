export class CanvasReadOnlyFormatError extends Error {
  readonly code = 'read_only_format';
  constructor() { super('画布含本版本无法无损处理的内容，已只读打开；原始元素未修改。请使用支持该格式的版本。'); }
}
export class CanvasContentPolicyError extends Error {
  readonly code = 'unmanaged_image';
  constructor() { super('画布内插图尚未接管为图片资产，请通过插入图片或粘贴图片文件导入；本批未保存，草稿仍保留。'); }
}
