// 该出口只包含跨进程 DTO 与纯解析，不加载任何平台 native runtime；Electron main
// 与不同业务的 Utility owner 都可以安全引用。
export {
  LocalProcessPlatformRuntimeSchema,
  parseLocalProcessPlatformRuntime,
  type LocalProcessPlatformRuntime,
} from './definitions/localProcessPlatformRuntime';
export {
  parseSerializedLocalProcessPlatformRuntime,
  serializeLocalProcessPlatformRuntime,
} from './functions/serializeLocalProcessPlatformRuntime';
