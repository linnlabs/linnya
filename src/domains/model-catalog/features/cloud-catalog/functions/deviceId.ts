/**
 * @file src/domains/model-catalog/features/cloud-catalog/functions/deviceId.ts
 *
 * @description
 * 生成稳定的匿名设备 ID（用于 Linnya Cloud 限额标识）。
 *
 * 算法：sha256(machineId + salt)。
 * 不使用环境变量，避免不同机器/打包形态产生不一致。
 */

import { createHash } from 'crypto';
import { createRequire } from 'module';
import { Logger } from 'src/shared/logger';

const logger = new Logger('DeviceId');
/**
 * 中文说明：
 * - CJS（Electron 主进程 bundle）下有 `__filename`；
 * - ESM（tsx 运行）下没有 `__filename`，此时退回到当前入口脚本或 workspace package.json；
 * - 禁止使用 `import.meta.url`，否则在 CJS 输出里会变成空对象，导致 createRequire 基准失效。
 */
const require = createRequire(
  typeof __filename === 'string' && __filename.length > 0
    ? __filename
    : process.argv[1] && process.argv[1].length > 0
      ? process.argv[1]
      : `${process.cwd()}/package.json`
);

/**
 * 固定盐值。修改它会让所有客户端的 distinct_id 发生漂移，慎重。
 */
const LINNYA_DEVICE_ID_SALT = 'linnya-device-id-salt-v1';

let cachedDeviceId: string | null = null;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

interface NodeMachineIdModule {
  machineId?: () => Promise<unknown>;
  default?: {
    machineId?: () => Promise<unknown>;
  };
}

function isNodeMachineIdModule(value: unknown): value is NodeMachineIdModule {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  const machineId = record.machineId;
  if (typeof machineId === 'function') {
    return true;
  }

  const defaultValue = record.default;
  if (!defaultValue || typeof defaultValue !== 'object') {
    return false;
  }

  const defaultRecord = defaultValue as Record<string, unknown>;
  return typeof defaultRecord.machineId === 'function';
}

/**
 * 获取当前设备的稳定匿名 ID。
 * 结果会缓存，多次调用返回同一值。
 * 失败时返回 null（不阻塞流程）。
 */
export async function getDeviceId(): Promise<string | null> {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    const modUnknown: unknown = require('node-machine-id');
    if (!isNodeMachineIdModule(modUnknown)) {
      logger.warn('node-machine-id 模块结构无效');
      return null;
    }

    const mod = modUnknown;
    const machineIdFn =
      typeof mod.machineId === 'function'
        ? mod.machineId
        : typeof mod.default?.machineId === 'function'
          ? mod.default.machineId
          : null;

    if (!machineIdFn) {
      logger.warn('无法获取 machineId 函数');
      return null;
    }

    const rawId: unknown = await machineIdFn();
    if (typeof rawId !== 'string' || rawId.length === 0) {
      logger.warn('machineId 返回值无效');
      return null;
    }

    cachedDeviceId = sha256Hex(`${rawId}:${LINNYA_DEVICE_ID_SALT}`);
    logger.info('设备 ID 生成成功');
    return cachedDeviceId;
  } catch (err) {
    logger.error('获取设备 ID 失败:', err);
    return null;
  }
}
