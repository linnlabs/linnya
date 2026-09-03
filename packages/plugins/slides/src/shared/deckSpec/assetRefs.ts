/**
 * AssetRef — 统一资产引用协议
 *
 * 图片、背景、logo 等资源的长期引用方式，
 * 避免裸路径或临时 base64 成为长期 DSL 字段。
 */

export type AssetRef =
  | { type: 'embedded'; partPath: string }
  | { type: 'data'; dataUri: string }
  | { type: 'external'; url: string };

export function isDataUri(src: string): boolean {
  return src.startsWith('data:');
}

export function isExternalUrl(src: string): boolean {
  return src.startsWith('http://') || src.startsWith('https://');
}

/** 将原始字符串归一化为 AssetRef，无法识别时返回 undefined */
export function normalizeAssetRef(raw: string | undefined): AssetRef | undefined {
  if (!raw) return undefined;
  if (isDataUri(raw)) return { type: 'data', dataUri: raw };
  if (isExternalUrl(raw)) return { type: 'external', url: raw };
  // PPTX 内嵌资源路径（如 ../media/image1.png）
  if (raw.includes('/') || raw.includes('\\')) return { type: 'embedded', partPath: raw };
  return undefined;
}
