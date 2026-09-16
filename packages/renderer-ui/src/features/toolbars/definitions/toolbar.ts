/** 坐标属于调用方的定位容器；组件不读取业务选区或改变滚动布局。 */
export interface FloatingToolbarPosition {
  readonly top: number;
  readonly left: number;
}

export interface FloatingToolbarProps {
  readonly show: boolean;
  readonly position: FloatingToolbarPosition;
}
