/** 坐标属于调用方的定位容器；组件不读取业务选区或改变滚动布局。 */
export interface FloatingToolbarPosition {
  readonly top: number;
  readonly left: number;
}

export interface FloatingToolbarProps {
  readonly show: boolean;
  readonly position: FloatingToolbarPosition;
}

export interface ToolbarButtonProps {
  readonly label: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
}

export interface ToolbarColorButtonProps extends ToolbarButtonProps {
  readonly kind: 'text' | 'background';
  /** 调用方解析内容颜色；包内不认识业务颜色 token 或保存格式。 */
  readonly color: string;
  readonly expanded: boolean;
}
