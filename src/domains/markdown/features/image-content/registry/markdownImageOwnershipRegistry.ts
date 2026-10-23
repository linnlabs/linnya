import type { MarkdownImageOwnershipPort } from '../definitions/markdownImageOwnership';

// 按数据库实例限定生命周期，多个 Desktop 不共享绑定；不暴露 Asset 账本或文件能力。
const bindings = new WeakMap<object, MarkdownImageOwnershipPort>();
export function bindMarkdownImageOwnership(scope: object, port: MarkdownImageOwnershipPort): void {
  bindings.set(scope, port);
}
export function getMarkdownImageOwnership(scope: object): MarkdownImageOwnershipPort | undefined {
  return bindings.get(scope);
}
