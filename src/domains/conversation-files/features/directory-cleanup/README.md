# Conversation Directory Cleanup

## 1. 业务合同

该 feature 为精准清空和完整删除提供同一套持久 cleanup job。job 是 conversation admission barrier，不是普通后台队列，也不是 renderer 的临时进度状态。

## 2. 状态和升级

同一 conversation 同时只能有一代活动 job。`clear_work_directory` 可以升级为 `delete_conversation`，反向降级不允许；新的请求复用当前 job id 并保留更强操作语义。job 至少记录 conversation identity、job id、operation、created/failed/completed 状态和失败诊断。

## 3. 执行顺序

1. 在短 gate 内创建或升级 job，并阻止新的 command/Flow admission。
2. gate 外让 App Host 停止 owner、等待进程树和输出/audit 收口。
3. 根据 operation 删除工作目录；目录已不存在时按幂等语义完成，unsafe entry 不可被“缺失”掩盖。
4. 完整删除继续删除批准、卡片事实、conversation facts 和 identity metadata。
5. 所有步骤成功后才写 complete；任何失败保留 job 和最近错误。

## 4. 安全边界

目录必须经过 identity marker、类型和 symlink/junction 检查。清理代码不能接受任意绝对路径，也不能把 Agent 传入的 cwd 当作删除目标。跨 domain 的停止顺序由 [conversation lifecycle workflow](../../../../app-hosts/linnya/application/conversation-lifecycle/README.md) 负责。

## 5. 测试

覆盖重复 job、clear→delete 升级、迟到 worker、目录缺失、坏 marker、文件锁、权限错误、跨重启恢复和另一对话并发。对于永久失败，测试必须验证 job 保留和 admission 仍被阻止，避免“失败后静默放行”。
