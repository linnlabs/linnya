export interface CanvasStatusAction {
  readonly label: string;
  readonly disabled?: boolean;
  readonly run: () => void;
}
/** 画布底部状态区的一条：进度与提示用 status，需要用户处理的失败用 alert。 */
export interface CanvasStatusItem {
  readonly id: string;
  readonly text: string;
  readonly tone: 'neutral' | 'error';
  readonly actions?: readonly CanvasStatusAction[];
}
