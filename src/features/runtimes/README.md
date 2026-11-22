# 原生运行时组件

插件所需的原生可执行程序（首个为 Qdrant）作为独立组件分发与安装，Host 只理解通用的运行时合同，不含具体插件语义。远程分发方案见私有 Proposal `plugin-remote-distribution`；catalog 合同见 [`src/features/plugins/catalog`](../plugins/catalog/README.md)。

## 布局

`$LINNYA_RUNTIME_ROOT`（Desktop 默认 `<userData>/runtimes`，CLI 默认 `<appData>/runtimes`）下：

- `<runtimeId>/<version>/`：不可变解压目录；
- `<runtimeId>/active.json`：当前版本指针，原子替换；
- `<runtimeId>/.receipts/<version>.json`：安装所依据的签名 catalog 信封、zip sha512、可执行文件相对路径与 SHA-256。

升级后只保留当前与上一版。

## 安装

`installRuntimeComponent` 由插件远程安装在下载插件之前调用（同一份已验签 catalog）：空间预检 → 流式下载（边下边算 sha512，字节数必须等于签名声明，支持取消与进度）→ 流式解压（条目限定在目录内，真实字节数不得超过 `unpackedSize`）→ 可执行文件 SHA-256 → 非 Windows 设置可执行位 → 写回执 → 切换指针。任一步失败都不改变现有 active 版本；同版本目录已存在时只在字节一致时复用，否则以 `version-conflict` 拒绝。插件已是当前版本但运行时缺失时，重装也会补齐运行时。安装前 Host 用 `isRuntimeComponentCurrent` 列出真正需要下载的运行时，用于进度计划与空间预检。

## 启动复核

`resolveInstalledRuntimeExecutable` 在每次启动运行时前执行：指针 → 回执 → 回执中的信封仍由受信 key 签发、列出本平台目标且未被撤回（含本机最近 catalog 的撤回）→ 可执行文件位于版本目录内且 SHA-256 一致。任一不符返回 `rejected` 并记诊断，不执行该文件。

Qdrant 的 `resolveQdrantProcessRuntime` 在启动时才解析：已安装且复核通过的运行时组件优先，其次安装包内的副本（旧版本随包分发），都没有时抛出 `QdrantRuntimeMissingError`。

## 声明与打包

- 插件在 `plugin.json` 用 `requiresRuntimes: [{ id, range }]` 声明所需运行时（node-semver range，同一 id 不重复）；catalog 生成器把它写入插件条目，并要求同一份 catalog 列出满足 range 的运行时组件，否则发布前失败。
- `scripts/release/package-runtime-component.mjs` 打包 Qdrant：可执行文件在 zip 根目录，随附按锁定 URL 与 SHA-256 获取的 LICENSE 和 NOTICE，条目时间固定以便复现；输出 `dist/runtime-components/<id>/<version>/<platform>-<arch>/` 与 `runtime.json`。正式发布由 linnya-release 先对可执行文件重签名再以 `--executable` 打包；不传时使用 prepare-qdrant-runtime 已按锁定清单校验的上游文件。
