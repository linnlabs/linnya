import assert from 'node:assert/strict';

import type { CommandPermissionSettingsPort } from '../../../../src/domains/commands/ports';
import {
  DEFAULT_COMMAND_PERMISSION_SETTINGS,
  serializeCommandPermissionSettings,
} from '../../../../src/domains/commands/features/permission-settings';
import {
  createJsonFileCommandPermissionSettingsPort,
} from '../../../../src/infra/adapters/command-permission-settings/json-file';

/**
 * 生产应用由启动流程创建首份权限设置；独立 Electron fixture 没有该 UI 启动流程，
 * 因此必须显式发布同一份 domain 默认设置，不能把“配置缺失”伪装成授权通过。
 */
export function createProductionE2eCommandPermissionSettings(
  filePath: string,
): CommandPermissionSettingsPort {
  const port = createJsonFileCommandPermissionSettingsPort({ filePath });
  const result = port.write(serializeCommandPermissionSettings(DEFAULT_COMMAND_PERMISSION_SETTINGS));
  assert.equal(result.status, 'written', 'production E2E command permission settings must be published');
  return port;
}
