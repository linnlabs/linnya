# Linnya 文档总图

这里是 Linnya 公开文档的统一入口。根目录 README 负责介绍项目和帮助第一次启动；本目录负责解释产品、工程结构、开发流程与各业务边界。

## 从哪里开始

| 你想了解什么 | 第一入口 |
| --- | --- |
| Linnya 是什么、从哪里来、现在与未来去哪里 | [产品模型总览](./product-model-overview.md) |
| 代码如何分层、一个改动应归谁、继续去哪里找细节 | [仓库工程协作指南](../AGENTS.md) |
| 安装、启动、构建、测试、环境变量和跨平台开发 | [开发指南](./development/README.md) |
| 公共文档应该保存什么、哪些过程材料不进公开仓 | [文档治理](./documentation-governance.md) |
| Conversation 的身份、事件、持久化、投影与渲染 | [Conversation Platform](./conversation-platform/README.md) |
| 插件边界、开发方式与发布模型 | [插件文档](./plugins/README.md) |
| 模型调用与 Provider 边界 | [Model Inference](./model-inference/README.md) |
| Shell、长进程与命令权限 | [命令执行](./command-execution/README.md) |

## 文档如何组织

- 产品级长期定义放在 `docs/`，例如产品模型、跨领域架构和开发流程。
- 单个 domain、feature、package 或 app 的稳定规则放在 owner 附近的 `README.md`。
- 类型、schema、port、registry 和 event 的最终事实以公开合同与实现为准。
- Proposal、阶段日志、调研过程和发布证据不进入公共仓；确认后的稳定结论必须回写到正式文档。

如果文档与代码不一致，先确认它是不是历史记录，再按“公开合同与 owner 实现 → owner README → 本文档地图”的顺序判断，并修正文档漂移。
