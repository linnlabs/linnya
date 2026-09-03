/**
 * @file textMeasurement.ts
 * @description 后端插件消费平台文本测量能力的窄门面。
 *
 * 中文说明：
 * - 文本测量是平台排版能力，不属于任何具体插件私有实现；
 * - 后端插件只能通过这个 SDK 消费，避免直接 import host 的
 *   `src/features/text-measurement` 内部路径。
 */

export {
  createSystemTextMeasurementRuntime,
} from 'src/features/text-measurement';

export {
  DEFAULT_TEXT_MEASURE_LINE_HEIGHT_MULTIPLIER,
  defaultTextMeasureService,
  emuToInches,
} from 'src/features/text-measurement';

export type PluginTextMeasureServicePort = import('src/features/text-measurement').TextMeasureService;
export type PluginSystemTextMeasurementRuntime = import(
  'src/features/text-measurement'
).SystemTextMeasurementRuntime;

export type {
  ClusterAdvanceMeasureResult,
  ClusterAdvanceRequest,
  TextMeasureAdvanceSource,
  TextMeasureService,
  TextMeasureInput,
  TextMeasurePadding,
  TextMeasureResult,
  TextMeasureSourceKind,
  TextMeasureWrapMode,
} from 'src/features/text-measurement';
