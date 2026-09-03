# Commands Features

Commands domain 的 feature 按业务能力切分，不按技术文件类型切分。

| Feature | 责任 |
| --- | --- |
| `shell-execution` | Shell 参数、cwd 和启动计划 |
| `process-control` | handle、观察、控制和终态 |
| `command-authorization` | 权限判断、高风险规则和审批记忆 |
| `permission-settings` | 全局设置和 run 快照 |
| `protected-input` | 用户直送 PTY 的输入合同 |
| `agent-command` | Shell/process 的模型观察与控制行格式（历史目录名保留） |
| `host-module-resolution` | 宿主固定 external 模块解析 |
| `process-execution` | 受控一次性进程执行 primitive |

前四个 feature 构成生产 `shell/process` 主链；其余 feature 服务于保护输入、宿主模块解析或公共兼容边界，不能被当成 Shell 权限的替代实现。

每个 feature 通过 `index.ts`、port 或 public contract 对外协作，禁止跨 feature 导入内部实现。新增业务能力应先判断它属于哪个 feature，不能把规则塞进 app host 或 Renderer。
