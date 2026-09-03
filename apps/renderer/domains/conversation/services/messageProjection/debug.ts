/**
 * @file messageProjection/debug.ts
 * @description 投影器调试日志总开关。
 *
 * 中文说明：
 * - 投影器的部分日志位于“逐事件热路径”上（thought / tool_call_decision / final_answer chunk 等）。
 * - 历史回放会一次性把整段会话的事件全部重放，逐事件日志会瞬间产生成百上千条输出；
 *   且 DevTools 打开时 `console.log(大对象)` 需要序列化并保留实时引用，会显著拖慢回放、造成“点击历史卡死”。
 * - 因此这些日志统一由本开关控制，默认关闭；需要排查投影时再临时改为 true。
 */
export const PROJECTION_DEBUG = false;
