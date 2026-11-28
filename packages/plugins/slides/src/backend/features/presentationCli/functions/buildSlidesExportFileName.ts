const MAX_BASE_NAME_LENGTH = 120;
// Windows 与 macOS 都不允许或会误解的字符；控制字符也不能进文件名。
const UNSAFE_FILE_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]/gu;

/**
 * 导出文件名 = 标题 + 版本号。带版本号是为了同一文稿多次导出不互相覆盖，
 * 用户和外部 Agent 能对照“第几版”交付；同一版本重复导出覆盖同名文件。
 */
export function buildSlidesExportFileName(exportedFileName: string, versionNumber: number): string {
  const withoutExtension = exportedFileName.replace(/\.pptx$/iu, '');
  const safe = withoutExtension
    .replace(UNSAFE_FILE_NAME_CHARACTERS, '_')
    .replace(/^[.\s]+|[.\s]+$/gu, '')
    .slice(0, MAX_BASE_NAME_LENGTH);
  // 标题全是被替换的符号时没有可用名字，用固定名代替。
  return `${safe || 'presentation'}-v${versionNumber}.pptx`;
}
