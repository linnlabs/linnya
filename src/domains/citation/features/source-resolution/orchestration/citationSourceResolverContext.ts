import type { CitationSourceResolverPort } from '../definitions/citationSource';

const resolverByToolContext = new WeakMap<object, CitationSourceResolverPort>();

/** Host 在需要持久化 Citation 的工具执行前绑定来源 resolver。 */
export function attachCitationSourceResolver(
  toolContext: object,
  resolver: CitationSourceResolverPort,
): void {
  resolverByToolContext.set(toolContext, resolver);
}

/** canonical citation 写入禁止绕过 Host 的来源 admission。 */
export function requireCitationSourceResolver(
  toolContext: object,
): CitationSourceResolverPort {
  const resolver = resolverByToolContext.get(toolContext);
  if (!resolver) {
    throw new Error('Citation persistence requires a host-admitted source resolver.');
  }
  return resolver;
}

/** 派生 ToolContext 时显式迁移 Citation 私有绑定，禁止靠对象展开假装复制 WeakMap。 */
export function copyCitationSourceResolver(
  source: object,
  target: object,
): void {
  const resolver = resolverByToolContext.get(source);
  if (resolver) resolverByToolContext.set(target, resolver);
}
