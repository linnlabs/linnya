# 官方插件 catalog

本 feature 负责把远端 catalog 变成可信输入：只有通过这里验签、有效期与回放检查的 catalog，才能作为 `catalog-official` 来源的依据。生产分发与信任边界见 [`docs/plugins/production-distribution-and-trust.md`](../../../../docs/plugins/production-distribution-and-trust.md)。

## 合同

- 数据形状在 `@app/schemas` 的 `SignedPluginCatalogPayloadSchema`：沿用可发现条目（名称、描述、开发者、权限、`artifactUrl`、`sha512` 等），并锁定 `size`、`unpackedSize`（解压后真实字节数，用于空间预检与解压上限）与 `requiresRuntimes`；另含原生运行时组件 `runtimes`（按平台/架构的 artifact、`size`/`unpackedSize` 与可执行文件摘要）和撤回列表 `revoked`。
- 信封：`{ schemaVersion, keyId, payload, signature }`。`payload` 是 canonical base64 的原始 JSON 字节，`signature` 是对这些字节的 Ed25519 签名；先验签后解析。
- 公钥在 `registry/trustedPluginCatalogKeys.ts`，与 Desktop 发行密钥分开；只放公钥，轮换新增、泄露删除。生产公钥在正式发布获批后加入，之前任何 catalog 都无法通过验签。

## 检查与失败关闭

`verifyPluginCatalog` 依次检查并在失败时抛出 `PluginCatalogRejectedError`（带分类 code）：

1. 信封与 payload 格式（`malformed`）；
2. key id 已登记（`untrusted-key`）、签名有效（`bad-signature`）；
3. 所有下载地址为 https，只有开发/测试组合显式允许本机 http（`insecure-url`）；
4. 通道匹配（`wrong-channel`）；
5. 有效期：签发与到期合法且不超过 90 天，允许 5 分钟时钟偏差（`not-yet-valid` / `expired`）；
6. 回放：序号不得小于本机记住的最近一份，同序号内容必须一致（`rollback`）；
7. 同一插件/运行时版本或同一平台目标不得重复（`malformed`）。

通过后返回冻结的 `VerifiedPluginCatalog`：`keyId`、payload 摘要 `digest`（写入安装回执）、序号、有效期，以及剔除撤回版本后的插件与运行时条目。调用方必须在任何拒绝时保留原有安装，不进入下载。

## 拉取、高水位与选版本

- `fetchVerifiedPluginCatalog`：拒绝重定向，20 秒超时，响应超过 1 MiB 不读入；验签通过后才把序号与摘要写入本机高水位。拒绝时按类别抛出 `PluginOperationError`：过期、尚未生效、通道不符归 `source-unavailable`（稍后可恢复），其余归 `artifact-integrity`；调用方取消原样传出。
- 本机高水位存在用户插件根下的 `.catalog-state.json`（原子替换写入，只前进不后退，按通道分开）。插件发现只认带 `active.json` 的子目录，不会把它当插件。文件损坏时按首次接受处理并留诊断，不让远程安装永久失效。
- `selectCatalogPluginRelease`：按版本从高到低选出当前 Host 兼容（`minApp`、`rendererUi`）且所需运行时能解析到本平台 artifact 的最高版本；运行时取满足 range 的最高版本。全部不可用时返回最高版本的原因：`incompatible` 或 `runtime-unavailable`。

## 安装回执与来源准入

- 远程安装通过 `RemotePluginReleaseSource` 取版本：official 组合使用 `createCatalogPluginReleaseSource`（每次重新拉取并验签 catalog，按上节规则选版本）；未签名 `latest.json` 只留给开发与 R2 smoke，不产生回执。需要原生运行时的版本在运行时组件落地前以 `incompatible` 拒绝。
- 暂存成功后、激活之前，在 `<userPluginRoot>/<pluginId>/.receipts/<version>.json` 写入回执：插件身份、zip 摘要、版本目录 SHA512SUMS 身份，以及安装所依据的完整签名信封（key id、摘要、序号）。崩溃在暂存与回执之间时，重装同版本走 already-staged 并补写。旧版本清理会同时删除其回执，卸载会连同回执一起移除。
- 启动准入（`isTrustedPluginAssembly` 的 catalog-official 路径）：回执中的信封必须仍由当前信任环中的 key 签发，信封列出该版本且 zip 摘要一致，版本目录身份与回执一致，且该版本未出现在本机最近接受的 catalog 撤回列表中。不看 catalog 有效期：过期不撤销已装插件；移除 key 或之后的 catalog 撤回该版本才撤销。
- 官方 catalog 地址为 `https://download.linnya.com/plugins/catalog/<channel>.json`。远程服务仍由 `isOfficialPluginRemoteServiceEnabled` 关闭，生产公钥也尚未加入。
