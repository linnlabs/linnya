/** 一个编辑器显式拥有的浮层；释放注册不负责移除该浮层DOM。 */
export type RegisterEditorFocusPortal = (element: HTMLElement) => () => void;
