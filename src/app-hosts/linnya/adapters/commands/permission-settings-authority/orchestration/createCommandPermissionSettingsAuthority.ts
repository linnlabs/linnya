import fs from 'node:fs';
import path from 'node:path';

import type { CommandPermissionSettingsPort } from 'src/domains/commands';
import {
  DEFAULT_COMMAND_PERMISSION_SETTINGS,
  serializeCommandPermissionSettings,
} from 'src/domains/commands/features/permission-settings';
import { createJsonFileCommandPermissionSettingsPort } from 'src/infra/adapters/command-permission-settings/json-file';

const INITIALIZATION_MARKER = 'command_permission_settings_initialized_v1\n';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type InitializationMarkerReadResult =
  | { readonly status: 'missing' }
  | { readonly status: 'found' }
  | { readonly status: 'failed'; readonly message: string };

function readInitializationMarker(markerPath: string): InitializationMarkerReadResult {
  try {
    const marker = fs.readFileSync(markerPath, 'utf8');
    if (marker !== INITIALIZATION_MARKER) {
      return {
        status: 'failed',
        message: '命令权限设置初始化标记内容无效。',
      };
    }
    return { status: 'found' };
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { status: 'missing' };
    }
    return {
      status: 'failed',
      message: `无法读取命令权限设置初始化标记：${errorMessage(error)}`,
    };
  }
}

function writeInitializationMarker(markerPath: string):
  | { readonly status: 'written' }
  | { readonly status: 'failed'; readonly message: string } {
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  } catch (error: unknown) {
    return {
      status: 'failed',
      message: `无法准备命令权限设置初始化标记目录：${errorMessage(error)}`,
    };
  }
  try {
    fs.writeFileSync(markerPath, INITIALIZATION_MARKER, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return { status: 'written' };
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      const existing = readInitializationMarker(markerPath);
      return existing.status === 'found'
        ? { status: 'written' }
        : {
            status: 'failed',
            message: existing.status === 'failed'
              ? existing.message
              : '命令权限设置初始化标记在创建竞争中消失。',
          };
    }
    return {
      status: 'failed',
      message: `无法记录命令权限设置已初始化：${errorMessage(error)}`,
    };
  }
}

/**
 * 当前 App 生命周期只从这里取得权限文档。磁盘只负责下次启动恢复，不能让 Shell
 * 在运行中改写文件后立即改变自己的权限；成功持久化 UI 更新后才替换内存快照。
 */
export function createCommandPermissionSettingsAuthority(input: {
  readonly settingsPath: string;
  readonly initializationMarkerPath: string;
}): CommandPermissionSettingsPort {
  const persistence = createJsonFileCommandPermissionSettingsPort({
    filePath: input.settingsPath,
  });
  let current = persistence.read();
  const marker = readInitializationMarker(input.initializationMarkerPath);

  if (marker.status === 'failed') {
    current = marker;
  } else if (current.status === 'missing' && marker.status === 'found') {
    current = {
      status: 'failed',
      message: '命令权限设置在完成初始化后缺失。',
    };
  } else if (current.status === 'missing') {
    const serializedDefault = serializeCommandPermissionSettings(
      DEFAULT_COMMAND_PERMISSION_SETTINGS,
    );
    const initialized = persistence.write(serializedDefault);
    if (initialized.status === 'failed') {
      current = initialized;
    } else {
      const marked = writeInitializationMarker(input.initializationMarkerPath);
      current = marked.status === 'written'
        ? { status: 'found', serialized: serializedDefault }
        : marked;
    }
  } else if (current.status === 'found' && marker.status === 'missing') {
    const marked = writeInitializationMarker(input.initializationMarkerPath);
    if (marked.status === 'failed') current = marked;
  }

  return Object.freeze({
    read: () => current,
    write(serialized: string) {
      const written = persistence.write(serialized);
      if (written.status !== 'written') return written;
      // 初始化标记只决定启动时 missing 是首次安装还是配置丢失。本次 authority
      // 建立时已经完成检查/补建；运行期更新若再次写标记，会把一次原子配置提交
      // 拆成两个文件步骤，导致磁盘已更新而内存仍停留在旧 revision。
      current = { status: 'found', serialized };
      return written;
    },
  });
}
