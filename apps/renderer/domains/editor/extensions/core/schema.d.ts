// 保留 JS 实现的公开合同：节点组与内容规则的单一事实来源。

export const NODE_GROUPS: {
  readonly BLOCK_CONTAINER: string;
  readonly BLOCK_CONTENT: string;
  readonly INLINE_CONTENT: string;
};

export const CONTENT_RULES: {
  readonly DOC: string;
  readonly BLOCK_CONTAINER: string;
  readonly BLOCK_CONTENT: string;
};

export function applySchemaToNode<Config extends { readonly name: string }>(
  nodeConfig: Config,
): Config & { readonly content?: string };

export function printSchemaRules(): void;

declare const schema: {
  readonly NODE_GROUPS: typeof NODE_GROUPS;
  readonly CONTENT_RULES: typeof CONTENT_RULES;
  readonly printSchemaRules: typeof printSchemaRules;
  readonly applySchemaToNode: typeof applySchemaToNode;
};
export default schema;
