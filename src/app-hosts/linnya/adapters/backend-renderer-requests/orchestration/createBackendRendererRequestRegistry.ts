import type {
  BackendRendererRequestHandler,
  BackendRendererRequestRegistryPort,
} from '../definitions/backendRendererRequest';

const MAX_REGISTERED_CHANNELS = 256;
const CHANNEL_PATTERN = /^[a-z][a-z0-9-]*(?::[A-Za-z0-9][A-Za-z0-9_-]*)+$/u;

/**
 * 这些名称是 Renderer 已发布的知识库 IPC 契约。它们早于命名空间约定，迁移 App Server
 * 不能偷偷改名，否则 preload 与现有 UI 会一起回归。只放行这组精确名称，不把任意无命名空间
 * 字符串扩成新的公共契约。
 */
const LEGACY_FLAT_CHANNELS = new Set([
  'create-kb',
  'delete-kb',
  'get-all-kbs',
  'get-documents-in-kb',
  'get-kb-graph-progress',
  'update-kb-settings',
]);

/** Backend 唯一 request handler 表；重复 channel 直接失败，不允许后注册覆盖。 */
export function createBackendRendererRequestRegistry(): BackendRendererRequestRegistryPort {
  const handlers = new Map<string, BackendRendererRequestHandler>();
  const registry: BackendRendererRequestRegistryPort = {
    handle(channel, handler) {
      if (!CHANNEL_PATTERN.test(channel) && !LEGACY_FLAT_CHANNELS.has(channel)) {
        throw new Error(`Backend Renderer request channel 不合法: ${channel}`);
      }
      if (handlers.has(channel)) {
        throw new Error(`Backend Renderer request channel 重复注册: ${channel}`);
      }
      if (handlers.size >= MAX_REGISTERED_CHANNELS) {
        throw new Error(`Backend Renderer request channel 超过上限 ${MAX_REGISTERED_CHANNELS}`);
      }
      handlers.set(channel, handler);
    },
    listChannels() {
      return Object.freeze([...handlers.keys()].sort());
    },
    async invoke(channel, args) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`Backend Renderer request channel 未注册: ${channel}`);
      }
      return handler(...args);
    },
  };
  return Object.freeze(registry);
}
