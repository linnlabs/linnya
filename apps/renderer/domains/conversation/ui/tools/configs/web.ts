/**
 * @file configs/web.ts
 * @description 联网工具（Web Search + Web Read）UI 配置
 */

import { defineAsyncComponent } from 'vue';
import type { ToolUiEntry } from '../types';
import { SearchIcon } from '@linnya/renderer-ui/icons';
import { ReadIcon } from '@linnya/renderer-ui/icons';
import { projectWebSearchPresentation } from '../websearch/functions/projectWebSearchPresentation';
import { projectWebSearchCompactStep } from '../websearch/functions/projectWebSearchPresentation';
import { projectWebReadPresentation, projectWebReadCompactStep } from '../webread/functions/projectWebReadPresentation';
import { projectWebReadImagePresentation } from '../webread/functions/projectWebReadImagePresentation';
import {
  resolveWebReadUiKey,
  WEB_READ_IMAGE_UI_KEY,
  WEB_READ_PAGE_UI_KEY,
} from '../webread/functions/resolveWebReadUiKey';
import { projectImageSearchPresentation } from '../imagesearch/functions/projectImageSearchPresentation';
import { createStaticToolCompactStepProjector } from '../compact-step/functions/createStaticToolCompactStepProjector';
import { ImageIcon } from '@linnya/renderer-ui/icons';

const WebSearchCard = defineAsyncComponent(() => import('../websearch/WebSearchCard.vue'));
const WebReadCard = defineAsyncComponent(() => import('../webread/WebReadCard.vue'));
const WebReadImageCard = defineAsyncComponent(() => import('../webread/WebReadImageCard.vue'));
const ImageSearchLine = defineAsyncComponent(() => import('../imagesearch/ImageSearchLine.vue'));

/** 下载的图、图片搜索都不套卡片，由组件自己画；失败时宿主画成一行。 */
const INLINE_LAYOUT = {
  hideBorder: true,
  hideBackground: true,
  noPadding: true,
  fullWidth: true,
  inlineError: true,
} as const;

export const webToolConfigs: Record<string, ToolUiEntry> = {
  web_search: {
    component: WebSearchCard,
    icon: SearchIcon,
    presentation: projectWebSearchPresentation,
    compactStep: projectWebSearchCompactStep,
    runtime: { subrunTrace: true, conversationId: true },
    layout: { fullWidth: true, defaultCollapsed: true },
  },

  search_web: {
    component: WebSearchCard,
    icon: SearchIcon,
    presentation: projectWebSearchPresentation,
    compactStep: projectWebSearchCompactStep,
    layout: { fullWidth: true, defaultCollapsed: true },
  },
  assemble_web_sources: {
    component: WebSearchCard,
    icon: SearchIcon,
    presentation: projectWebSearchPresentation,
    compactStep: projectWebSearchCompactStep,
    layout: { fullWidth: true, defaultCollapsed: true },
  },

  // 网页与文件走网页卡；下载的图片直接显示。分流按正式结果，结果到达前按请求地址。
  web_read: {
    resolveUiKey: resolveWebReadUiKey,
  },
  [WEB_READ_PAGE_UI_KEY]: {
    component: WebReadCard,
    icon: ReadIcon,
    presentation: projectWebReadPresentation,
    compactStep: projectWebReadCompactStep,
    layout: { fullWidth: true, defaultCollapsed: true },
  },
  [WEB_READ_IMAGE_UI_KEY]: {
    component: WebReadImageCard,
    icon: ImageIcon,
    presentation: projectWebReadImagePresentation,
    compactStep: createStaticToolCompactStepProjector('conversation.tool.webReadImage.compact'),
    layout: INLINE_LAYOUT,
  },

  image_search: {
    component: ImageSearchLine,
    icon: ImageIcon,
    presentation: projectImageSearchPresentation,
    compactStep: createStaticToolCompactStepProjector('conversation.tool.imageSearch.compact'),
    layout: INLINE_LAYOUT,
  },
};
