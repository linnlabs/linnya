import { SemanticLayerError } from '../definitions/semanticLayer';

const MAX_NAME_LENGTH = 64;

/** 显示名：去掉首尾空白、合并连续空白；不改大小写。 */
export function cleanSemanticName(raw: string): string {
  const name = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!name) throw new SemanticLayerError('invalid_name', '名称不能为空');
  if ([...name].length > MAX_NAME_LENGTH) {
    throw new SemanticLayerError('invalid_name', `名称最多 ${MAX_NAME_LENGTH} 个字符`);
  }
  if (name.startsWith('#') || name.startsWith('@')) {
    throw new SemanticLayerError('invalid_name', '名称不能以 # 或 @ 开头');
  }
  return name;
}

/**
 * 唯一性比较用的键：NFKC 归一化后做大小写折叠。在 JS 里做，不依赖 SQLite 的 lower()
 * （它只折叠 ASCII，全角与带重音的字母会被当成不同名称）。
 */
export function semanticNameKey(name: string): string {
  return cleanSemanticName(name).toLowerCase();
}
