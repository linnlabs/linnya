# 09 · Skill 与资源

> 适用场景：插件携带模型技能（SKILL.md）、cookbook、reference 等资源。

## 资源布局与声明

- 真实 Skill 资源放插件包 `resources/skills/<skill-name>/SKILL.md`（可带 `references/`、cookbook 等附属文件），随 artifact 分发。
- manifest 的 `skills` 字段只负责商店展示：声明了 `skills`，artifact 与 extraResources 打包脚本会强制要求包内存在 `resources/skills`，防止展示与实际资源漂移。没有真实 skill 就不要写该字段。
- 源码态（inline 开发模式）通过 backend contribution 的 `skillResourceRoots` 声明资源根。
- agent prompt 点名某个 skill 时，agent 定义必须写 `config.skill.requiredSkills`；运行态会校验该 skill 真实存在，避免 prompt 和 artifact 漂移。

## 运行链路

skill 是一条**资源链路**，不只是 manifest 字段。一个插件 skill 要完整工作，以下环节都要通：

1. discovery：enabled 磁盘插件的 `resources/skills` 与官方 inline 的 `skillResourceRoots` 进入 skill catalog。
2. 工具消费：`SkillTool` 自持 `activate`、`list_resources`、`read_resource` 三种动作；Skill 资源不经过 VFS 或通用 Resource 工具。
3. 优先级：同名 skill 按 `builtin > plugin > user` 取。
4. 启停门禁：插件启停会刷新 skill cache，禁用后 skill 从 catalog 与 `skill` 工具的可读资源范围中收缩。
5. 打包：artifact zip 与 extraResources 都要包含 skill 资源。

## 注意

- skill discovery 有缓存：生产态约 5 分钟 TTL，插件启停会主动失效（`invalidateSkillCache()`）；**开发态（`LINNYA_DEV_MODE=true`）TTL 为 0、不缓存，手改 SKILL.md 立即生效**（见 `src/features/skills/discovery.ts`）。
- agent prompt 引用 skill 名的一致性约束见 [08 Agent](./08-agents.md)；官方插件还会通过契约测试检查 `requiredSkills` 与随包资源一致。
- host build 不得把插件 skill 复制进 host 自己的 builtin-skills 目录——那会造成「卸载后 skill 还在」的资源残影（重型指南 §8 有完整残影清单）。
