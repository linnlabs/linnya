import type { CitationRefAllocatorPort } from '../definitions/citationRefAllocator';

const allocatorByToolContext = new WeakMap<object, CitationRefAllocatorPort>();

/** Host 在 citation producer 执行前绑定 Conversation 级分配端口。 */
export function attachCitationRefAllocator(
  toolContext: object,
  allocator: CitationRefAllocatorPort
): void {
  allocatorByToolContext.set(toolContext, allocator);
}

export function requireCitationRefAllocator(toolContext: object): CitationRefAllocatorPort {
  const allocator = allocatorByToolContext.get(toolContext);
  if (!allocator) {
    throw new Error('Citation producer requires a host-admitted ref allocator.');
  }
  return allocator;
}

/** 派生 ToolContext 时显式迁移 Citation 私有绑定。 */
export function copyCitationRefAllocator(source: object, target: object): void {
  const allocator = allocatorByToolContext.get(source);
  if (allocator) allocatorByToolContext.set(target, allocator);
}
