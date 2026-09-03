/**
 * @file textMeasurement.ts
 * @description 渲染端插件消费平台文本测量与字体解析的门面。
 *
 * 中文说明：
 * - 文本测量是平台排版能力，不属于任何具体插件私有实现；
 * - 插件只能通过这个 renderer SDK 消费，避免直接 import host 的
 *   `src/features/text-measurement` 或 `apps/renderer/shared` 内部路径。
 */

import {
  resolveRendererFont,
  resolveRendererFontFamily,
  type FontResolution,
  type FontResolutionOptions,
} from '@/shared/utils/fontResolution';
import { BrowserPretextAdapter } from '../../features/text-measurement/adapters/BrowserPretextAdapter.js';
import { HeuristicMeasureAdapter } from '../../features/text-measurement/adapters/HeuristicMeasureAdapter.js';
import { DEFAULT_TEXT_MEASURE_LINE_HEIGHT_MULTIPLIER } from '../../features/text-measurement/definitions/types.js';
import { TextMeasureService } from '../../features/text-measurement/orchestration/TextMeasureService.js';
import type {
  TextMeasureAdapter,
  TextMeasureInput,
  TextMeasureResult,
  TextMeasureWrapMode,
} from '../../features/text-measurement/definitions/types.js';

export type {
  FontResolution,
  FontResolutionOptions,
  TextMeasureAdapter,
  TextMeasureInput,
  TextMeasureResult,
  TextMeasureWrapMode,
};

const rendererTextMeasureService = new TextMeasureService({
  primary: new BrowserPretextAdapter(),
  fallback: new HeuristicMeasureAdapter(),
});

export function getRendererTextMeasureService(): TextMeasureService {
  return rendererTextMeasureService;
}

export {
  DEFAULT_TEXT_MEASURE_LINE_HEIGHT_MULTIPLIER,
  resolveRendererFont,
  resolveRendererFontFamily,
};
