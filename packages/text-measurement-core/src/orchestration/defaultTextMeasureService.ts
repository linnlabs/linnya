import { TextMeasureService } from './TextMeasureService.js';

/**
 * Node/Worker 可直接使用的确定性默认实例。宿主可在自己的 composition root
 * 注入浏览器测量或 HarfBuzz；portable core 本身不感知 Electron 和系统字体。
 */
export const defaultTextMeasureService = new TextMeasureService();
