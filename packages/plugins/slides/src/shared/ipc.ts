import { SLIDES_PLUGIN_ID } from './pluginMeta';

/** @deprecated Use SLIDES_PLUGIN_ID from pluginMeta instead. */
export { SLIDES_PLUGIN_ID };

export const SLIDES_IPC = {
  sourceSlices: 'slides:source-slices',
  inspect: 'slides:inspect',
  preview: 'slides:preview',
  buildState: 'slides:build-state',
  renderModel: 'slides:render-model',
  templatesList: 'slides:templates-list',
  // M6 决策：PPTX -> editable deck 的直接导入入口仍暂停。
  // 这里仅允许上传 PPTX 作为模板来源；重新接入文档导入前必须先补 imported->Konva 保真验收。
  templateImport: 'slides:template-import',
  export: 'slides:export',
} as const;

export const SLIDES_IPC_CHANNELS = [
  SLIDES_IPC.sourceSlices,
  SLIDES_IPC.inspect,
  SLIDES_IPC.preview,
  SLIDES_IPC.buildState,
  SLIDES_IPC.renderModel,
  SLIDES_IPC.templatesList,
  SLIDES_IPC.templateImport,
  SLIDES_IPC.export,
] as const;

export const SLIDES_PUSH_EVENTS = {
  imageExportProgress: 'slides:image-export-progress',
} as const;

export const SLIDES_PUSH_CHANNELS = [
  SLIDES_PUSH_EVENTS.imageExportProgress,
] as const;

export type SlidesIpcChannel = typeof SLIDES_IPC_CHANNELS[number];
export type SlidesPushChannel = typeof SLIDES_PUSH_CHANNELS[number];

export const SLIDES_TEMPLATE_IMPORT_MAX_BYTES = 50 * 1024 * 1024;

export type OperationResult<T = unknown> =
  | { success: true; data?: T }
  | {
      success: false;
      error: string;
      diagnostic?: {
        code: 'validation' | 'missing' | 'disabled' | 'permission_denied' | 'missing_handler' | 'crash';
        pluginId?: string;
        channel?: string;
        message: string;
      };
    };
