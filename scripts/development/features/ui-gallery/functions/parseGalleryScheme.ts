import { CURRENT_GALLERY_SCHEME_ID, type GalleryScheme } from '../definitions/galleryScheme.ts';

const SCHEME_FILE_PATTERN = /^([a-z0-9][a-z0-9-]*)\.css$/;
const LEADING_COMMENT_PATTERN = /^\s*\/\*([\s\S]*?)\*\//;

/** 方案文件名只允许小写字母、数字和连字符，保证能直接放进 URL 参数。 */
export function readGallerySchemeId(fileName: string): string {
  const match = SCHEME_FILE_PATTERN.exec(fileName);
  if (!match) {
    throw new Error(`候选方案文件名只能用小写字母、数字和连字符并以 .css 结尾：${fileName}`);
  }
  const id = match[1];
  if (id === CURRENT_GALLERY_SCHEME_ID) {
    throw new Error(`${fileName} 与画廊保留的“现状”方案同名，请改名`);
  }
  return id;
}

/** 文件开头第一段注释的第一行非空文字作为方案名称。 */
export function readGallerySchemeLabel(css: string): string | null {
  const comment = LEADING_COMMENT_PATTERN.exec(css)?.[1];
  if (comment === undefined) return null;
  const firstLine = comment
    .split('\n')
    .map(line => line.replace(/^\s*\*?\s?/, '').trim())
    .find(line => line.length > 0);
  return firstLine ?? null;
}

export function parseGalleryScheme(fileName: string, css: string): GalleryScheme {
  const id = readGallerySchemeId(fileName);
  return { id, label: readGallerySchemeLabel(css) ?? id, css };
}
