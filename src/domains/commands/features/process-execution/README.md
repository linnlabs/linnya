# Registered Process Execution

## 定位

这是 Plugin CLI 的一次性 Node 进程执行边界。它维护固定 argv、cwd 和错误合同，不是 Shell/process runtime，也不提供 PTY、长期 handle、Windows Job accounting 或 raw byte artifact。

## 允许的调用链

Plugin CLI host → 插件 parser → process port → 既有结果投影。插件 ID、argv 前缀、cwd 和模块来源由 host 固定；模型不能把 launcher 变成任意外部命令。

## 生命周期

创建后只允许一次 start；根进程退出、停止请求和错误分别投影，调用方不能只看 child `exit` 就宣称业务完成。该兼容 feature 的输出/停止逻辑不得被复制到 Shell owner。

## 维护注意

Agent 调用插件领域命令走正常 Shell execution：Shell 进程树只包含极小原生 facade，当前 App 内的插件
invocation 是父 execution 的受管子活动。不得在本兼容 feature 或插件内增加第二套进程 owner。人、开发脚本
和 CI 的 standalone CLI 若需要整树清理或 PTY，才应评估复用公共进程底座。

## 测试

覆盖参数严格校验、目录越界、根退出、停止请求、启动失败和错误分类，并确认 Shell production scope 没有反向引用此兼容 feature。
