import type { MessageCatalogContribution } from '@app/localization';
import { CHROME_MESSAGES } from './catalogs/chromeMessages';
import { ERROR_MESSAGES } from './catalogs/errorMessages';
import { FAILURE_MESSAGES } from './catalogs/failureMessages';
import { CONNECTION_MESSAGES } from './catalogs/connectionMessages';
import { INPUT_MESSAGES } from './catalogs/inputMessages';
import { PANEL_MESSAGES } from './catalogs/panelMessages';
import { REVIEW_MESSAGES } from './catalogs/reviewMessages';

const ZH = {
  ...CHROME_MESSAGES.zh,
  ...CONNECTION_MESSAGES.zh,
  ...ERROR_MESSAGES.zh,
  ...FAILURE_MESSAGES.zh,
  ...INPUT_MESSAGES.zh,
  ...PANEL_MESSAGES.zh,
  ...REVIEW_MESSAGES.zh,
} as const;
const EN = {
  ...CHROME_MESSAGES.en,
  ...CONNECTION_MESSAGES.en,
  ...ERROR_MESSAGES.en,
  ...FAILURE_MESSAGES.en,
  ...INPUT_MESSAGES.en,
  ...PANEL_MESSAGES.en,
  ...REVIEW_MESSAGES.en,
};

export type CanvasMessageKey = keyof typeof ZH;
/** 中文源文案：没有激活的 Pinia（单元测试、预览）时直接用它。 */
export const CANVAS_ZH_MESSAGES: Readonly<Record<CanvasMessageKey, string>> = ZH;
export const CANVAS_EN_MESSAGES: Readonly<Record<CanvasMessageKey, string>> = EN;
export const CANVAS_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'canvas',
  catalogs: { 'zh-CN': ZH, 'en-US': EN },
};
