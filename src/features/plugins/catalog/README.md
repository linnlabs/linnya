# 官方插件 catalog

本 feature 负责把远端 catalog 变成可信输入：只有通过这里验签、有效期与回放检查的 catalog，才能作为 `catalog-official` 来源的依据。生产分发与信任边界见 [`docs/plugins/production-distribution-and-trust.md`](../../../../docs/plugins/production-distribution-and-trust.md)。

## 合同

- 数据形状在 `@app/schemas` 的 `SignedPluginCatalogPayloadSchema`：沿用可发现条目（名称、描述、开发者、权限、`artifactUrl`、`sha512` 等），并锁定 `size` 与 `requiresRuntimes`；另含原生运行时组件 `runtimes`（按平台/架构的 artifact 与可执行文件摘要）和撤回列表 `revoked`。
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
