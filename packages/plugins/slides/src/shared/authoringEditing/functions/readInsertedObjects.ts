import { isRecord } from '../../valueRecord';
import type { SlidesInsertedObject } from '../definitions/insertedObject';
import { isSlidesAuthoringKey } from './authoringIdentity';
import { isEditableTextContent, isAuthorTextStyle } from './editableText';

/** 源码与 IPC 共用严格值合同；不接纳任意 Layout 属性或远程资源。 */
export function readInsertedObjects(value: unknown): { value: readonly SlidesInsertedObject[] } | { error: string } {
  if (!Array.isArray(value) || value.length > 1000) return { error: '新增对象必须是最多 1000 项的数组。' };
  const result: SlidesInsertedObject[] = [];
  const keys = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || !isSlidesAuthoringKey(entry.editKey) || keys.has(entry.editKey)) return { error: '新增对象需要唯一的 editKey。' };
    const box = entry.box;
    if (!isRecord(box) || !only(box, ['x', 'y', 'w', 'h'])
      || !finite(box.x) || !finite(box.y) || !finite(box.w) || !finite(box.h) || box.w <= 0 || box.h <= 0) return { error: '新增对象的位置和正尺寸必须是有限数字。' };
    const base = { editKey: entry.editKey, box: { x: box.x, y: box.y, w: box.w, h: box.h } };
    const common = ['kind', 'editKey', 'box'];
    if (entry.kind === 'text' && only(entry, [...common, 'content', 'style', 'heightMode'])
      && (entry.heightMode === undefined || entry.heightMode === 'content' || entry.heightMode === 'minimum')
      && isEditableTextContent(entry.content) && isAuthorTextStyle(entry.style)) {
      result.push({ ...base, kind: 'text', content: entry.content, style: entry.style,
        ...(entry.heightMode !== undefined ? { heightMode: entry.heightMode } : {}) });
    } else if (entry.kind === 'shape' && only(entry, [...common, 'geometry', 'fill', 'content'])
      && (entry.geometry === 'rect' || entry.geometry === 'ellipse') && typeof entry.fill === 'string' && /^#[0-9a-f]{6}$/iu.test(entry.fill) && isEditableTextContent(entry.content)) {
      result.push({ ...base, kind: 'shape', geometry: entry.geometry, fill: entry.fill, content: entry.content });
    } else if (entry.kind === 'image' && only(entry, [...common, 'assetId', 'fit', 'alt'])
      && typeof entry.assetId === 'string' && entry.assetId.length > 0
      && (entry.fit === 'contain' || entry.fit === 'cover') && typeof entry.alt === 'string') {
      result.push({ ...base, kind: 'image', assetId: entry.assetId, fit: entry.fit, alt: entry.alt });
    } else return { error: `新增对象 ${entry.editKey} 的类型或作者值无效。` };
    keys.add(entry.editKey);
  }
  return { value: result };
}
function only(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every(key => keys.includes(key)); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
