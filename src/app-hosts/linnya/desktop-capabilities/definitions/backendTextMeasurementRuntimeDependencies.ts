import type { MeasurementWorkerManagerPort } from '../../../../features/text-measurement/infrastructure/browser-pretext/MeasurementClient';

export type TextMeasurementWorkerAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

/** Desktop Host 托管的浏览器 Pretext worker；请求和响应必须保持 data-only。 */
export interface DesktopTextMeasurementWorkerPort extends MeasurementWorkerManagerPort {
  readonly availability: TextMeasurementWorkerAvailability;
}

/** Backend 文本测量 runtime 的完整 composition 输入。 */
export interface BackendTextMeasurementRuntimeDependencies {
  readonly worker: DesktopTextMeasurementWorkerPort;
  readonly useBrowserPretext: boolean;
  readonly useHarfBuzz: boolean;
}
