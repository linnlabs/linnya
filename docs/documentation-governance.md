# Linnya 文档治理

公共仓文档只保存贡献者理解、构建、验证和长期维护 Linnya 所必需的稳定事实。实现过程、内部调研、阶段验收记录和未公开产品决策不属于公共源码合同。

## 公共文档

以下内容必须随源码公开并与实现同步：

- public contract、schema、port、registry、event 和插件接口；
- domain、feature、package 与 app-level orchestration 的 owner 和边界；
- 构建、测试、贡献、安全、许可证和发布验证入口；
- 当前真实支持范围、已知限制和会影响贡献者判断的安全约束；
- 已经确认并长期生效的架构决策。

稳定规则优先写在对应 owner 附近的 `README.md`。跨多个 owner 的长期规则可以写入 `docs/` 下按主题命名的正式文档，但不能依赖内部过程记录才能理解。

## 非公共过程文档

内部 Proposal、研究过程、失败尝试、阶段日志、发布证据和仍需内部决策的产品计划保存在独立私有仓，不进入公共 Linnya Git 树。

公共源码、测试、构建和文档必须满足：

1. 不读取或假设相邻私有 checkout 存在；
2. 不链接私有文档、私有 issue、内部 URL 或本机绝对路径；
3. 不把私有过程文档作为实现正确性的唯一依据；
4. 私有方案形成稳定结论时，先把结论回写到对应公共 owner 文档，再修改实现；
5. 公共仓中的重大设计讨论通过 GitHub Issue、Pull Request 描述或公开 owner 文档完成。

## 历史与优先级

公共 Git history 用于追溯已经公开的实现演进，不承担内部过程档案职责。私有过程记录即使引用某个公共 commit，也不能覆盖该 commit 中的 schema、实现和 owner 文档。

发生冲突时，依次以可执行 schema/public contract、owner 实现、相邻稳定 README、本工程地图为准。历史 Proposal、audit、迁移记录和 release note 只提供背景。
