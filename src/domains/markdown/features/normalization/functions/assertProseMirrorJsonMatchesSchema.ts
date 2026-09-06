import type { Schema } from 'prosemirror-model';

import type { ProseMirrorJsonNode } from '../types';

type SchemaTypeWithAttributes = {
  readonly spec: {
    readonly attrs?: Readonly<Record<string, unknown>>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertKnownAttributes(params: {
  value: unknown;
  schemaType: SchemaTypeWithAttributes;
  path: string;
  owner: string;
}): void {
  const { value, schemaType, path, owner } = params;
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new Error(`[MarkdownSchema] ${path}.attrs 必须是对象`);
  }

  const knownAttributes = schemaType.spec.attrs ?? {};
  for (const attributeName of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(knownAttributes, attributeName)) {
      throw new Error(
        `[MarkdownSchema] ${path} 的 ${owner} 包含未知属性 "${attributeName}"`
      );
    }
  }
}

function assertMarkJson(value: unknown, schema: Schema, path: string): void {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error(`[MarkdownSchema] ${path} 必须是带 type 的 mark 对象`);
  }

  const markType = schema.marks[value.type];
  if (!markType) {
    throw new Error(`[MarkdownSchema] ${path} 包含未知 mark "${value.type}"`);
  }

  assertKnownAttributes({
    value: value.attrs,
    schemaType: markType,
    path,
    owner: `mark "${value.type}"`,
  });
}

function assertNodeJson(value: unknown, schema: Schema, path: string): void {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error(`[MarkdownSchema] ${path} 必须是带 type 的 node 对象`);
  }

  const nodeType = schema.nodes[value.type];
  if (!nodeType) {
    throw new Error(`[MarkdownSchema] ${path} 包含未知 node "${value.type}"`);
  }

  assertKnownAttributes({
    value: value.attrs,
    schemaType: nodeType,
    path,
    owner: `node "${value.type}"`,
  });

  if (value.marks !== undefined) {
    if (!Array.isArray(value.marks)) {
      throw new Error(`[MarkdownSchema] ${path}.marks 必须是数组`);
    }
    value.marks.forEach((mark, index) => {
      assertMarkJson(mark, schema, `${path}.marks[${index}]`);
    });
  }

  if (value.content !== undefined) {
    if (!Array.isArray(value.content)) {
      throw new Error(`[MarkdownSchema] ${path}.content 必须是数组`);
    }
    value.content.forEach((child, index) => {
      assertNodeJson(child, schema, `${path}.content[${index}]`);
    });
  }

  if (value.type === 'text') {
    if (typeof value.text !== 'string' || value.text.length === 0) {
      throw new Error(`[MarkdownSchema] ${path}.text 必须是非空字符串`);
    }
    if (value.content !== undefined) {
      throw new Error(`[MarkdownSchema] 文本节点 ${path} 不允许包含 content`);
    }
  } else if (value.text !== undefined) {
    throw new Error(`[MarkdownSchema] 非文本节点 ${path} 不允许包含 text`);
  }
}

/**
 * 严格检查 JSON 的 node/mark/attrs，再调用 ProseMirror `check()` 验证内容表达式和 mark 组合。
 * `nodeFromJSON()` 会静默丢弃未知 attrs，单独调用它不构成严格校验。
 */
export function assertProseMirrorJsonMatchesSchema(
  docJson: ProseMirrorJsonNode,
  schema: Schema
): void {
  assertNodeJson(docJson, schema, 'doc');
  const documentNode = schema.nodeFromJSON(docJson);
  documentNode.check();
}
