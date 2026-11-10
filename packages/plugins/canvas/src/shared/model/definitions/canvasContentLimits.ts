/** 与宿主值传输的128层JSON边界一致；先检查再进入递归schema，不能靠栈溢出拒绝输入。 */
export const CANVAS_CONTENT_MAX_DEPTH = 128;
