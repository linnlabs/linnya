import { CanvasUserError } from '../../localization';

/** 送达未知：写调用方据此用同一请求身份确认结果；消息已是当前语言，原文在 cause。 */
export class CanvasDeliveryUnknownError extends CanvasUserError {
  override readonly name: string = 'CanvasDeliveryUnknownError';
}
export interface CanvasConfirmedMutation<T> {
  /** send闭包冻结requestId和完整payload；确认重试不能重建用户意图。 */
  send(): Promise<T>;
  /** 已有ack后只重试接纳，不再调用send。 */
  accept(result: T): Promise<void>;
}
