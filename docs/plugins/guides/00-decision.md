# 00 · 先判断：要不要建插件包

> 适用场景：开始做一个新功能之前；或评估某个 host 功能是否应该插件化。

仓库里有过重型功能「先长在 host、事后再插件化」的实战教训（现行参考见 [Slides 插件说明](../../../packages/plugins/slides/README.md)；旧分阶段归档不在仓库内）：**事后插件化的成本，远高于第一天就建插件包。** 新功能动手前先过下面这张判断表。

## 信号判断表

| 信号 | 说明 |
|---|---|
| 自有文件格式 | 功能引入新的文档类型（自带文件后缀），需要 `DocumentTypeBackendHook` + `DocumentTypeContribution`。 |
| 自有数据表 | 需要新建只属于该功能的表，要 `ownedTables` + plugin migrations。 |
| 自有 agent / 工具 / skill | 给模型新增工具、agent、subagent 或 skill 资源，且这些能力应随功能启停收缩。 |
| 重引擎 / 重资源 | 有体量较大的编译 / 解析 / 渲染引擎或大体积静态资源。 |
| 用户可独立启停 | 这个功能用户应该能在插件商店里单独安装、禁用、卸载。 |

判断口径：

- **命中 2 条及以上 → 第一天就建 `packages/plugins/<id>`**，按 [01 包结构](./01-package-structure.md) 三构建面起步，不要先写进 host 再说。
- 只命中 0–1 条、且确定是平台通用能力（被多个功能复用、不随单个功能启停）→ 留 host。
- **核心陷阱**：把「以后再抽包」当默认选项。功能一旦长在 host 里，shared 几何/类型、host 工具旁路、renderer store 耦合会以编译期 import 的形式越缠越深；事后解耦要先拆「运行时耦合」再拆「编译期耦合」，是两轮工作（见 [17 重型插件开发进阶](./17-heavy-plugins.md) 的阶段方法论）。
- 先对号入座再决定第一天投入：**轻插件**（引擎在 Renderer、结构化数据持久化、无宿主重型设施）按各章节标准流程即可；**重插件**（App Server backend 重引擎 + 必要的 Desktop 沙箱/隐藏预览 + 自有几何或度量）额外参照重型插件进阶指南。

## 新插件接入路线（总 checklist）

按顺序做，每步对应一个章节：

1. 新建 `packages/plugins/<id>`，拆出 `shared/backend/renderer` 三个构建面 → [01](./01-package-structure.md)
2. 写 `plugin.json`，补全用户可见字段、entry、compat、ownedFileTypes、ownedTables、migrations → [02](./02-manifest.md)
3. 包内 `src/shared/pluginMeta.ts` 从 `plugin.json` 派生 meta，不在 Host 手写第二份；补 manifest 一致性测试。是否进入官方运行面由 release composition / 验签 catalog 与产品信任策略决定，不在 Host 增加插件 ID policy → [02](./02-manifest.md) / [生产插件分发与信任策略](../production-distribution-and-trust.md)
4. 实现 backend contribution → [03](./03-backend-contribution.md)
5. 实现 renderer contribution → [04](./04-renderer-contribution.md)
6. 如有文档格式，接入 `DocumentTypeBackendHook` 与 `DocumentTypeContribution` → [05](./05-document-types.md)
7. 如有数据库表，写 plugin migrations、ownedTables 和升级失败回滚测试 → [06](./06-database.md)
8. 如有工具 / agent / skill，按对应章节贡献并验证启停收缩 → [07](./07-tools.md) / [08](./08-agents.md) / [09](./09-skills.md)
9. 如有 IPC，注册真实 channel 并声明白名单 → [10](./10-ipc.md)
10. 需要宿主新能力时，按「五件套」新增窄门面，不要 deep import host → [11](./11-host-facades.md)
11. 加独立 build/package 脚本；重型 backend 产出可由通用磁盘 loader 装载的 artifact → [13](./13-build-and-bundles.md)
12. 跑安装 / 启停 / 卸载 / 升级与 R2 smoke → [14](./14-lifecycle.md) / [15](./15-release.md) / [16](./16-testing-and-guards.md)
13. 更新本目录手册和插件自己的 README。
