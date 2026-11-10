export class CanvasDeliveryUnknownError extends Error {
  override readonly name = 'CanvasDeliveryUnknownError';
}
export interface CanvasConfirmedMutation<T> {
  /** send闭包冻结requestId和完整payload；确认重试不能重建用户意图。 */
  send(): Promise<T>;
  /** 已有ack后只重试接纳，不再调用send。 */
  accept(result: T): Promise<void>;
}
