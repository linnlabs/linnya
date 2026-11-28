import type { ConversationOptions } from '@app/schemas';

/**
 * 判断一次运行是否从头到尾都不会请求模型。
 *
 * Host 直接调用（外部命令 `tools call` 等）在工具批次结算后就把结果交还调用方，执行图不会走到
 * 模型节点。这类运行不需要绑定聊天模型：只用自己的外部 Agent、没有登录也没有配置任何模型的
 * 安装，同样要能读写文档。其余运行一律要有模型，接纳时就该失败，而不是跑到一半才发现。
 */
export function runCompletesWithoutModel(options: ConversationOptions | undefined): boolean {
  return options?.host_tool_call?.completion_mode === 'yield_after_batch';
}
