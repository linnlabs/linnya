import { describe, expect, it } from 'vitest';

import {
  analyzePackageManifestForRemoteTelemetry,
  analyzeProductionSourceForRetiredAnalytics,
  runRemoteTelemetryBoundaryGuard,
} from '../guards/remote-telemetry-boundary-guard';

describe('remote telemetry boundary guard', () => {
  it('当前生产树保持远程 telemetry 零基线', () => {
    expect(runRemoteTelemetryBoundaryGuard()).toEqual([]);
  });

  it('拒绝常见远程 analytics 与崩溃上报 SDK', () => {
    expect(
      analyzePackageManifestForRemoteTelemetry('package.json', {
        dependencies: { 'posthog-js': '1.0.0', vue: '3.0.0' },
        devDependencies: { '@sentry/electron': '1.0.0' },
      })
    ).toEqual([
      expect.objectContaining({ detail: 'dependencies: posthog-js' }),
      expect.objectContaining({ detail: 'devDependencies: @sentry/electron' }),
    ]);
  });

  it('拒绝恢复已退役的行为埋点表和稳定安装身份', () => {
    expect(
      analyzeProductionSourceForRetiredAnalytics(
        'src/features/analytics/schema.ts',
        'const table = "behavior_events"; const identity = "install_id";'
      )
    ).toEqual([
      expect.objectContaining({ detail: 'behavior_events' }),
      expect.objectContaining({ detail: 'install_id' }),
    ]);
  });

  it('允许本地 engine telemetry 合同', () => {
    expect(
      analyzeProductionSourceForRetiredAnalytics(
        'src/app-hosts/linnya/adapters/telemetry/sqlite.ts',
        'const table = "engine_telemetry";'
      )
    ).toEqual([]);
  });
});
