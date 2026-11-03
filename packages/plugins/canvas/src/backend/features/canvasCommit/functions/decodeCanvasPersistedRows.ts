import { z } from 'zod';
import { generateKeyBetween } from 'fractional-indexing';
import { validateCanvasTextContent } from './validateCanvasContent';
import { CanvasReadOnlyFormatError } from '../definitions/canvasContentFailure';
export { CanvasReadOnlyFormatError };
import { CanvasElementSchema, type CanvasIntegrityIssue } from '../../../../shared';
import type { CanvasStoredElement } from '../definitions/canvasCommit';
import { quarantineCanvasRelations } from './quarantineCanvasRelations';
const rowSchema = z.object({ element_id: z.string(), element_json: z.string(), field_versions_json: z.string(), field_origins_json: z.string() });
const versions = z.record(z.string(), z.number().int().nonnegative());
const origins = z.record(z.string(), z.string());
const knownTypes = new Set(['text', 'image', 'document', 'edge']);


/** 解码与隔离属于读取规则，仓储只取原始列；绝不把未知数据改写成占位节点。 */
export function decodeCanvasPersistedRows(values: readonly unknown[]) {
  const rows: CanvasStoredElement[] = [], issues: CanvasIntegrityIssue[] = [];
  for (const value of values) {
    const stored = rowSchema.parse(value);
    let json: unknown;
    try { json = JSON.parse(stored.element_json); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; issues.push({ elementId: stored.element_id, code: 'invalid_element', message: '元素JSON损坏，原始数据保留并从显示中隔离。' }); continue; }
    const kind = z.object({ type: z.string() }).safeParse(json);
    if (kind.success && !knownTypes.has(kind.data.type)) {
      issues.push({ elementId: stored.element_id, code: 'unknown_element', message: '本版本不认识该元素类型，原始数据保留。' }); continue;
    }
    try {
      const element = CanvasElementSchema.parse(json);
      if (element.id !== stored.element_id) throw new Error('canvas_row_identity_mismatch');
      generateKeyBetween(element.order, null);
      if (element.type === 'text') validateCanvasTextContent(element.data.content);
      rows.push({ element, fieldVersions: versions.parse(JSON.parse(stored.field_versions_json)), fieldOrigins: origins.parse(JSON.parse(stored.field_origins_json)) });
    } catch (error) {
      // 此边界只调用纯内容/排序验证器；仓储读取和业务副作用不在try内。
      if (!(error instanceof Error)) throw error;
      issues.push({ elementId: stored.element_id, code: 'invalid_element', message: '元素内容或字段版本不合法，原始数据保留并从显示中隔离。' });
    }
  }
  const graph = quarantineCanvasRelations(rows);
  return { rows: graph.rows, issues: [...issues, ...graph.issues] };
}
