import type { ISchemaProvider } from '../../../../shared/database/schema-provider';
import { PLUGIN_PLATFORM_STATE_SCHEMAS } from './plugin-state.schema';

/**
 * 插件安装态和迁移账本属于宿主插件平台，不属于任何业务插件。
 * fresh bootstrap 必须能从当前 schema 直接建立这些表，历史 migration 只负责旧库升级。
 */
export class PluginStateSchemaProvider implements ISchemaProvider {
  readonly name = 'plugin-platform-state';

  getSchema(): string[] {
    return PLUGIN_PLATFORM_STATE_SCHEMAS;
  }
}
