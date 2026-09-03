/**
 * Workspace asset 的 canonical 身份解析端口。
 *
 * URI 是内容寻址事实，asset ID 继续沿用现有 UUID 身份约定。调用方必须在构造
 * durable message/event 前通过该端口解析 ID，不能根据 hash 自行派生另一套身份。
 */
export interface WorkspaceAssetIdentityPort {
  resolveCanonicalAssetId(uri: string): string;
}
