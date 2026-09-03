import type { Schema } from 'prosemirror-model';

export interface WorkspaceMarkdownSchemaContract {
  readonly nodes: Readonly<Record<string, readonly string[]>>;
  readonly marks: Readonly<Record<string, readonly string[]>>;
}

function readSchemaAttributes(
  schemaTypes: Readonly<Record<string, {
    readonly spec: { readonly attrs?: Readonly<Record<string, unknown>> };
  }>>
): Readonly<Record<string, readonly string[]>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(schemaTypes).map(([name, type]) => [
        name,
        Object.freeze(Object.keys(type.spec.attrs ?? {}).sort()),
      ])
    )
  );
}

/**
 * 从 Markdown 领域的正式 ProseMirror schema 生成窄语义合同。
 *
 * 合同只暴露可持久化 node/mark 名称和属性名，不把后端 Schema 实例泄漏给 Renderer。
 * Renderer conformance 门禁消费这份值，因此后端新增语义时会自动要求生产 Editor 同步实现。
 */
export function createWorkspaceMarkdownSchemaContract(
  schema: Schema
): WorkspaceMarkdownSchemaContract {
  return Object.freeze({
    nodes: readSchemaAttributes(schema.nodes),
    marks: readSchemaAttributes(schema.marks),
  });
}
