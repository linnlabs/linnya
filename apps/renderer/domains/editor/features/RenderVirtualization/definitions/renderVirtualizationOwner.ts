/**
 * renderVirtualizationOwner.ts
 *
 * RenderVirtualization 运行期 owner 契约。
 *
 * 中文说明：
 * - 虚拟化运行期表必须按 editor 实例隔离，避免多 editor 并存时互相清理；
 * - owner 只作为 WeakMap key，不承载业务能力，避免 registry 退化成全局上帝对象。
 */

export type RenderVirtualizationOwner = object
