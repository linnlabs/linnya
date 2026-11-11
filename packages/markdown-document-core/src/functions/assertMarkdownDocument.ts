import { isRecord } from '@linnya/foundation';
import type { Schema, Node as ProseMirrorNode } from '@tiptap/pm/model';

type SchemaTypeWithAttributes = {
  readonly spec: {
    readonly attrs?: Readonly<Record<string, unknown>>;
  };
};


function assertKnownAttributes(params: {
  value: unknown;
  schemaType: SchemaTypeWithAttributes;
  path: string;
  owner: string;
  diagnosticOwner: string;
}): void {
  const { value, schemaType, path, owner, diagnosticOwner } = params;
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new Error(`[${diagnosticOwner}] ${path}.attrs 必须是对象`);
  }

  const knownAttributes = schemaType.spec.attrs ?? {};
  for (const attributeName of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(knownAttributes, attributeName)) {
      throw new Error(`[${diagnosticOwner}] ${path} 的 ${owner} 包含未知属性 "${attributeName}"`);
    }
  }
}

function assertMarkJson(
  value: unknown,
  schema: Schema,
  path: string,
  diagnosticOwner: string
): void {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error(`[${diagnosticOwner}] ${path} 必须是带 type 的 mark 对象`);
  }

  const markType = schema.marks[value.type];
  if (!markType) {
    throw new Error(`[${diagnosticOwner}] ${path} 包含未知 mark "${value.type}"`);
  }

  assertKnownAttributes({
    value: value.attrs,
    schemaType: markType,
    diagnosticOwner,
    path,
    owner: `mark "${value.type}"`,
  });
}

function assertNodeJson(
  value: unknown,
  schema: Schema,
  path: string,
  diagnosticOwner: string
): void {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error(`[${diagnosticOwner}] ${path} 必须是带 type 的 node 对象`);
  }

  const nodeType = schema.nodes[value.type];
  if (!nodeType) {
    throw new Error(`[${diagnosticOwner}] ${path} 包含未知 node "${value.type}"`);
  }

  assertKnownAttributes({
    value: value.attrs,
    schemaType: nodeType,
    diagnosticOwner,
    path,
    owner: `node "${value.type}"`,
  });

  if (value.marks !== undefined) {
    if (!Array.isArray(value.marks)) {
      throw new Error(`[${diagnosticOwner}] ${path}.marks 必须是数组`);
    }
    value.marks.forEach((mark, index) => {
      assertMarkJson(mark, schema, `${path}.marks[${index}]`, diagnosticOwner);
    });
  }

  if (value.content !== undefined) {
    if (!Array.isArray(value.content)) {
      throw new Error(`[${diagnosticOwner}] ${path}.content 必须是数组`);
    }
    value.content.forEach((child, index) => {
      assertNodeJson(child, schema, `${path}.content[${index}]`, diagnosticOwner);
    });
  }

  if (value.type === 'text') {
    if (typeof value.text !== 'string' || value.text.length === 0) {
      throw new Error(`[${diagnosticOwner}] ${path}.text 必须是非空字符串`);
    }
    if (value.content !== undefined) {
      throw new Error(`[${diagnosticOwner}] 文本节点 ${path} 不允许包含 content`);
    }
  } else if (value.text !== undefined) {
    throw new Error(`[${diagnosticOwner}] 非文本节点 ${path} 不允许包含 text`);
  }
}

/**
 * 严格检查 JSON 的 node/mark/attrs，再调用 ProseMirror `check()` 验证内容表达式和 mark 组合。
 * `nodeFromJSON()` 会静默丢弃未知 attrs，单独调用它不构成严格校验。
 */
export function assertMarkdownDocument(
  docJson: unknown,
  schema: Schema,
  diagnosticOwner = 'MarkdownSchema'
): ProseMirrorNode {
  assertNodeJson(docJson, schema, 'doc', diagnosticOwner);
  const documentNode = schema.nodeFromJSON(docJson);
  documentNode.check();
  return documentNode;
}
