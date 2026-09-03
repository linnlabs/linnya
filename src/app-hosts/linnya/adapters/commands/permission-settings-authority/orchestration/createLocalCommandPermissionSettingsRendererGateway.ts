import type { CommandPermissionSettingsPort } from 'src/domains/commands/ports';
import {
  CommandPermissionSettingsError,
  readCommandPermissionSettings,
  updateCommandPermissionSettings,
} from 'src/domains/commands/features/permission-settings';
import type { CommandPermissionSettingsRendererGatewayPort } from '../definitions/commandPermissionSettingsRendererGateway';

/** 把 authority 的领域错误投影成现有设置页合同；本地与 RPC client 返回同一结果。 */
export function createLocalCommandPermissionSettingsRendererGateway(
  settings: CommandPermissionSettingsPort,
): CommandPermissionSettingsRendererGatewayPort {
  const gateway: CommandPermissionSettingsRendererGatewayPort = {
    async read() {
      try {
        return { success: true, settings: readCommandPermissionSettings(settings) };
      } catch (error: unknown) {
        if (error instanceof CommandPermissionSettingsError
          && (error.code === 'invalid_config' || error.code === 'read_failed')) {
          return { success: false, code: error.code };
        }
        return { success: false, code: 'read_failed' };
      }
    },
    async update(update) {
      try {
        return {
          success: true,
          settings: updateCommandPermissionSettings({ port: settings, update }),
        };
      } catch (error: unknown) {
        if (!(error instanceof CommandPermissionSettingsError)) {
          return { success: false, code: 'read_failed' };
        }
        if (error.code === 'invalid_update'
          || error.code === 'invalid_config'
          || error.code === 'read_failed') {
          return { success: false, code: error.code };
        }
        if (error.code === 'revision_conflict' || error.code === 'write_failed') {
          try {
            return {
              success: false,
              code: error.code,
              settings: readCommandPermissionSettings(settings),
            };
          } catch (readError: unknown) {
            if (readError instanceof CommandPermissionSettingsError
              && readError.code === 'invalid_config') {
              return { success: false, code: 'invalid_config' };
            }
            return { success: false, code: 'read_failed' };
          }
        }
        return { success: false, code: 'read_failed' };
      }
    },
  };
  return Object.freeze(gateway);
}
