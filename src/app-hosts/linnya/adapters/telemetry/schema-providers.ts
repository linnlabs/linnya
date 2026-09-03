/**
 * @file src/app-hosts/linnya/adapters/telemetry/schema-providers.ts
 * @description 聚合 Linnya backend telemetry 相关的 schema providers，供 DatabaseService 注册。
 */

import type { ISchemaProvider } from '../../../../shared/database/schema-provider';
import { TelemetrySchemaProvider } from './telemetry-schema.provider';

export function getTelemetrySchemaProviders(): ISchemaProvider[] {
  return [new TelemetrySchemaProvider()];
}
