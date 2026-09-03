# 生产插件分发与信任边界

本文档定义 Linnya packaged 产品加载官方插件时必须遵守的稳定安全边界。它不定义具体插件业务，也不开放第三方代码执行。

## 当前支持范围

Linnya Core 只理解通用插件合同，不保存具体插件 ID、业务名称、Agent、Prompt、文档类型或产品语义。源码是否公开、是否与 Core 同仓，也不能证明一个插件是官方插件。

packaged 产品只允许两类来源：

| 来源 | 身份依据 | packaged 行为 |
| --- | --- | --- |
| `bundled-official` | 受保护产品装配清单锁定的不可变 artifact | 允许 |
| `catalog-official` | 发布方签名 catalog 锁定的版本、摘要和兼容范围 | 允许 |
| `development-direct` | 开发者显式指定的本地目录 | 拒绝 |
| `third-party-signed` | 未来第三方信任模型 | 当前拒绝 |
| `unknown` | 没有可信来源证明 | 拒绝 |

开发态可以从 workspace 或显式目录直载插件。这项能力只服务开发、测试和受控 artifact smoke，不能通过普通环境变量带入 packaged 生产模式。

## 不变量

1. `plugin.json` 只能声明插件能力，不能声明或提升自身官方身份。
2. 同一个 `pluginId@version` 只能对应一份不可变 artifact；回滚和撤回移动指针，不覆盖已发布字节。
3. SHA512 只证明下载字节与清单一致，不证明清单由 Linnya 发布方签发。
4. packaged 模式是不可降级的运行事实，开发直载目录和下载地址覆盖不能改变生产准入结果。
5. 下载或安装成功不等于允许执行；backend、Renderer、CLI、migration、IPC 和 hidden worker 启动前都必须通过来源准入。
6. 未知、验签失败、摘要不符、版本不符、兼容性不符或已撤回的 artifact 必须在执行前失败关闭。
7. 拒绝未知 artifact 时保留用户文档和插件数据；删除或恢复必须走独立、明确、可恢复的流程。
8. Core 不得为产品策略引入具体插件 ID allowlist 或私有插件语义。
9. 签名私钥、生产写入凭据、私有源码和内部发布地址不进入公共仓；通用验证逻辑、schema 和验证公钥可以公开。

## Bundled 来源

每次桌面产品构建都应生成产品装配 manifest，锁定应用版本、来源 commit、插件 ID、版本、artifact 摘要、兼容范围和安装包内相对位置。

启动 seed 只接收清单中声明且字节一致的 artifact。位于 `extraResources/plugins` 或其他受扫描目录中，不会自动获得官方身份。开发 smoke 可以生成明确标记为 development 的同结构 fixture，但它不能成为生产信任输入。

## Catalog 与远程安装

远程安装必须遵循以下顺序：

1. 获取 catalog 原始字节并验证发布方签名；
2. 从已验签 entry 选择精确版本和下载位置；
3. 下载到隔离暂存区；
4. 校验摘要、安全解压、文件白名单、manifest 身份和兼容范围；
5. 写入可回溯 catalog digest、key ID、artifact digest 和来源类别的安装回执；
6. 安装到不可变版本目录；
7. 执行迁移与激活事务；
8. 启动或切换前再次完成来源准入。

任何失败都必须保留原 active version，不能让半安装 artifact 进入执行目录。Catalog 未完成发布方签名以前，现有 `latest.json` 与 SHA512 链路只能视为完整性机制，不能描述成完整的官方身份验证。

## 第三方插件

当前插件 backend 是受信任的 Node 代码，可以接触数据库、文件系统、网络、IPC、CLI、migration 和原生能力。Manifest 中的 `permissions` 只是前瞻描述，不是已经执行的安全沙箱。

开放第三方插件前，必须另行完成进程隔离、Renderer 边界、强制权限执行、签名者注册与吊销、密钥轮换、数据迁移隔离和权限变更确认。在这些能力落地前，即使第三方 artifact 带有签名，packaged 产品也必须拒绝执行。

## Owner

- 插件结构和运行合同：[`docs/plugins/README.md`](./README.md)
- 插件生命周期：[`docs/plugins/guides/14-lifecycle.md`](./guides/14-lifecycle.md)
- Artifact 与发布：[`docs/plugins/guides/15-release.md`](./guides/15-release.md)
- 插件商店投影：[`docs/plugins/guides/18-store-presentation.md`](./guides/18-store-presentation.md)
- 公共/私有文档边界：[`docs/documentation-governance.md`](../documentation-governance.md)
