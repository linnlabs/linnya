import { protocol } from 'electron';
import {
  getMediaProtocolPrivilegedScheme,
  getPluginProtocolPrivilegedScheme,
} from './definitions/privilegedSchemes';

/**
 * Electron 要求 privileged scheme 在 ready 之前同步登记。该步骤必须保持轻量，
 * 不能顺带初始化日志、路径、数据库或任何业务 runtime。
 */
export function registerAppProtocolSchemesAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    getPluginProtocolPrivilegedScheme(),
    getMediaProtocolPrivilegedScheme(),
  ]);
}
