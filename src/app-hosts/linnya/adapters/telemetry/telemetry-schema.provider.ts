/**
 * @file src/app-hosts/linnya/adapters/telemetry/telemetry-schema.provider.ts
 * @description Linnya backend SqliteTelemetryAdapter 的 schema provider。
 */

import { ISchemaProvider } from '../../../../shared/database/schema-provider';
import { ENGINE_TELEMETRY_SCHEMA } from './telemetry.schema';

export class TelemetrySchemaProvider implements ISchemaProvider {
  readonly name = 'engine_telemetry';

  getSchema(): string[] {
    return ENGINE_TELEMETRY_SCHEMA;
  }
}
