/** 同一算法用于源码标记和沙箱；出现不同路径同 key 时由沙箱拒绝，不选择候选。 */
export function hashAuthoringPath(text: string): string {
  let a = 2166136261, b = 3339675911;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 2246822519);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
