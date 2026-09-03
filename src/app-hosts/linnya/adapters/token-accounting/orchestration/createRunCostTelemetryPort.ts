import { telemetry } from 'linnkit/runtime-kernel';
import type { LinnyaRunCostCollector } from '../collectors/linnyaRunCostCollector';

type TelemetryEvent = telemetry.TelemetryEvent;
type TelemetryPort = telemetry.TelemetryPort;

/**
 * 只服务 child-run cost 聚合的轻量 TelemetryPort。
 *
 * 中文备注：
 * - 顶层 flow 使用 `SqliteTelemetryAdapter`，会同时写 SQLite 与 RunCostCollector；
 * - 同步 child-run 当前不走顶层 flow bootstrap，因此这里提供一个只聚合 cost 的端口；
 * - 这不是后台执行机制，也不落产品事件，只把 `scope.runId/parentRunId` 交给 cost collector。
 */
export function createRunCostTelemetryPort(costCollector: LinnyaRunCostCollector): TelemetryPort {
  return {
    emit(event: TelemetryEvent): void {
      costCollector.ingestTelemetry(event);
    },
  };
}
