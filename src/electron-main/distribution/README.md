# Desktop 发行身份

本目录是 Electron Main 对 Desktop 发行来源的 adapter。它读取安装包 Resources 中的
`desktop-distribution.json`，先用应用内受信 Ed25519 公钥验证原始 payload，再把严格
payload 投影为共享 `DistributionIdentity`。

源码运行不读取清单，恒为 `source`；打包后缺少清单、未知 key、签名失败、版本不符或
格式非法都稳定降为 `community`。只有验签成功才能成为 `official`。当前受信 key ring
为空，因此本地和社区打包不会意外启用官方服务。

发行清单不包含 secret。公开 key 可以提交，私钥只能由受保护发布环境持有。平台代码
签名、公证和 Authenticode 仍由打包流程负责；本目录不执行签名，也不把客户端身份当作
Cloud 账号权限。

## 修改地图

- 清单 envelope/payload：`definitions/desktopDistributionManifest.ts`
- 原始 payload 验签：`functions/verifyDesktopDistributionManifest.ts`
- Electron 资源读取与安全降级：`orchestration/resolveElectronDistributionIdentity.ts`
- 受信公开 key：`registry/trustedDesktopDistributionKeys.ts`

## 验证

```bash
pnpm vitest run src/electron-main/distribution
```
