/**
 * 停留这么久开始取数据，并在还不可见的浮层里排首屏；多数情况下到露出时内容已经排好。
 * 不从 0 开始：鼠标路过也会触发后端读取，带图文档的一次读取并不便宜。
 */
export const HOVER_PREVIEW_PREPARE_DELAY_MS = 150;
/** 停留这么久才露出浮层：鼠标扫过引用时不弹。 */
export const HOVER_PREVIEW_REVEAL_DELAY_MS = 400;
/** 到露出时间内容还没排好，最多再等这么久；仍没好就先露出占位，避免占位闪一下就被内容换掉。 */
export const HOVER_PREVIEW_READY_GRACE_MS = 150;
/** 露出后指针离开触发处与浮层，保留这么久再关：留出从触发处移进浮层的时间。 */
export const HOVER_PREVIEW_CLOSE_DELAY_MS = 200;

export interface HoverPreviewScheduleHandlers {
  /** 开始取数据并挂载内容，此时浮层必须还不可见、不接收指针。 */
  prepare(): void;
  /** 让浮层可见。 */
  reveal(): void;
  /** 释放浮层与在途读取；准备之后任何时候都可能被调用，且只调用一次。 */
  close(): void;
}

export interface HoverPreviewSchedule {
  /** 指针进入触发处；immediate 用于键盘聚焦和点击，不等停留时间。 */
  enter(immediate?: boolean): void;
  /** 指针离开触发处或浮层。 */
  leave(): void;
  /** 指针进入浮层：取消等待中的关闭。 */
  stay(): void;
  /** 内容已排好（或已确定失败并给出提示），可以露出。 */
  ready(): void;
  close(): void;
}
