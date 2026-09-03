# Host Module Resolution

## 定位

该 feature 只为 Plugin CLI 解析宿主固定 external module。它解决“插件 CLI 需要一个随 App 发布的模块”这一问题，不是通用插件依赖注入，也不是 Shell 的 CLI 管理器。

## 合同

- 模块名白名单写在 host 代码中，模型、manifest 和用户参数不能提供 package specifier。
- 调用方必须绑定当前插件 CLI 和允许目录。
- 插件停用、目录身份不匹配、模块不在白名单或发布版路径不完整时关闭解析。
- Shell、Python、npm、brew、pnpm 等普通 CLI 不经过这里，也不由 Linnya 安装或升级。

## 为什么独立

Plugin CLI 有固定插件语义和发布物；把它和任意 Shell 模块解析混合，会让插件命令绕过 Shell 审批或让 Shell 继承不适用的 artifact policy。

## 测试

覆盖固定模块、specifier 注入、目录越界、插件停用、发布版路径、native 模块缺失和 Windows/macOS 路径差异。
