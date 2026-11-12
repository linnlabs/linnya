export type CanvasQuery =
  | { readonly kind: 'read' }
  | {
      readonly kind: 'show' | 'find' | 'neighbors' | 'region';
      readonly value: string;
      readonly depth: number;
      /** find 只留下带这个标签（标签或状态均算）的卡；工作区标签 ID。 */
      readonly tag?: string;
      /** find 只留下状态是这个标签的卡；工作区标签 ID。 */
      readonly status?: string;
    };
