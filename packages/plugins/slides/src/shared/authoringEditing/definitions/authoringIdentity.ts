import type { SlidesManualTargetKind } from './manualEdits';

/**
 * generated deck 作者对象的稳定编辑身份。
 *
 * 身份来自显式 key 或系统调用来源；循环来源仅在同一生成程序内对应。
 * 长期身份不按页码、源码行、正文或几何位置猜测。
 */
export interface SlidesAuthoringEditRef {
  readonly slideKey: string;
  readonly editKey: string;
}

/** 编译产物携带的作者对象事实；targetKind 不参与稳定身份计算。 */
export interface SlidesAuthoringObjectRef extends SlidesAuthoringEditRef {
  readonly targetKind: SlidesManualTargetKind;
}

export const SLIDES_AUTHORING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
