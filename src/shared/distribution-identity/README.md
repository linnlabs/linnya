# Desktop Distribution Identity

本目录拥有 Desktop 进程启动时冻结的发行身份合同。它只区分源码运行、社区打包和官方
发行，不负责用户账号、Cloud entitlement、平台签名执行或更新下载。

## 身份

- `source`：未打包的源码运行；
- `community`：已经打包，但没有受信 Linnya 发行清单；
- `official`：发行清单由应用内受信公钥验签通过。

`app.isPackaged` 只决定资源布局，不能证明官方身份；`LINNYA_DEV_MODE` 只保留开发路径、
热加载和诊断语义。普通环境变量、Renderer 输入和 App Server 自行探测都不能提升发行
身份。

Electron Main 解析身份后通过 `installDistributionIdentity` 在当前运行域冻结，并把同一
data-only DTO 放入 App Server bootstrap。App Server 严格解析后再次安装；后端 owner
只能通过本目录公开入口读取，不能重新读取发行清单或环境变量。

## 安全边界

发行身份决定是否连接或启用官方更新、官方插件远端服务、Cloud 等客户端能力，但不是
服务端授权。Cloud 必须独立验证可过期、可撤销的账号 token，并在服务端执行
entitlement、额度和计量；插件 artifact 也必须独立完成 catalog 签名与执行前准入。

新增官方服务时，应消费窄 policy 函数或冻结身份，不能重新发明
`NODE_ENV === 'production'`、`!LINNYA_DEV_MODE` 或 `app.isPackaged` 判断。

## 验证

```bash
pnpm vitest run src/shared/distribution-identity
```
