import { SemanticLayerError } from '../definitions/semanticLayer';
import { SEMANTIC_QUERY_BUILTIN_FIELDS, type SemanticQueryBuiltinField } from '../features/query/definitions/semanticQuery';
import { semanticNameKey } from './normalizeSemanticName';

/** 名称（按名称唯一性同一规则归一）是否与查询的内建字段同名。 */
export function builtinFieldNamed(name: string): SemanticQueryBuiltinField | undefined {
  let key: string | null;
  try { key = semanticNameKey(name); } catch { key = null; }
  return SEMANTIC_QUERY_BUILTIN_FIELDS.find(builtin => builtin === key);
}

/** 字段不能与内建字段同名：查询里写这个名字时无法区分是哪一个。 */
export function assertNotBuiltinFieldName(name: string): void {
  const builtin = builtinFieldNamed(name);
  if (builtin) {
    throw new SemanticLayerError(
      'reserved_name',
      `“${name}”是内建字段名（${SEMANTIC_QUERY_BUILTIN_FIELDS.join('、')}），请换一个字段名`,
      { builtinFields: [...SEMANTIC_QUERY_BUILTIN_FIELDS] },
    );
  }
}
