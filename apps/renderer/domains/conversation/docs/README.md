# Conversation 域文档索引

Conversation 域是 Linnya 的前端对话投影与渲染边界。它消费 Linnkit 的通用 Runtime/SSE 协议和 Linnya 的产品 UI DTO，但不拥有 Runtime、Host persistence 或插件内部业务。

> **规则不在本文。** 全链路权威规范在仓根 [`docs/conversation-platform/`](../../../../../docs/conversation-platform/README.md)。本文只保留**域内导航**：目录结构与本地实现级文档。
>
> 不变量一律引用 [`00-invariants.md`](../../../../../docs/conversation-platform/00-invariants.md) 的 `INV-nn` 编号，不在域内复述。

---

## 阅读入口

跨 Host、持久化、schema、实时投影和 Renderer 的问题，统一从 [Conversation Platform 文档地图](../../../../../docs/conversation-platform/README.md#2-文档地图) 查找。本目录不复制全链路索引，只维护 Renderer Conversation owner 的实现级规范。

## 本目录的实现级规范

| 文档 | 管什么 |
|---|---|
| [`conversation-virtualization.md`](./conversation-virtualization.md) | 三层虚拟化（数据 / 渲染 / timeline）、媒体管线、估高体系、滚动契约与红线表 |
| [`input-contribution.md`](./input-contribution.md) | 输入框贡献框架：三原语（Reference / Input Extension / Trigger）、五能力契约、`user_quote` items[] wire、插件 SDK 物理隔离 |

引用的跨 owner 合同由 [Citation domain](../../../../../src/domains/citation/README.md#conversation-展示链路) 维护；活动与 Subrun 的完整规范见 [Conversation Subruns](../../../../../docs/conversation-platform/10-subruns.md)。

更贴代码的说明：`../history/README.md`、`../ui/messageCanvas/README.md`、`../ui/conversationView/README.md`、`../ui/components/timeline/README.md`。

---

## 目录结构

```text
apps/renderer/domains/conversation/
├── definitions/                 # domain 公共契约与文案键
├── functions/                   # 消息可见性、答案判空、引用、user_quote wire、内容相位等纯规则
├── services/
│   ├── messageProjection/       # SSE / 历史事件到 live message 的唯一投影入口
│   └── orchestration/           # 发送、编辑、重生成、投影提交与取消收尾
├── history/                     # 历史列表、打开会话、loading 壳与窗口分页编排
├── message-window/              # UI read model 窗口、DTO 校验、加载编排与 Pinia 状态
├── features/
│   ├── agent-choice/            # 会话级 agent 选择与显式持久化编排
│   ├── annotation-run/          # 编辑器批注 run 的独立执行态
│   ├── answer-segment/          # 答案段按 answer_id + seq 增量归并（主时间线与 Subrun 完整消息共用）
│   ├── composer-references/     # 输入框引用的公开边界（kind/provider 注册表）
│   ├── conversation-title/      # 新会话一次性自动标题、手动改名与写入串行化
│   ├── context-window-usage/    # 成功 Prompt 快照到输入框上下文占用的纯派生与展示
│   ├── image-attachments/       # 图片附件选择与几何
│   ├── input-accessories/       # 运行期输入附件槽
│   ├── input-action-menu/       # 输入区动作菜单
│   ├── input-extensions/        # 输入扩展宿主边界（唯一 active 解析 + 执行态聚合）
│   ├── interactive-run/         # conversation-scoped foreground run、HITL 恢复与取消控制面
│   ├── model-selection/         # Host picker 快照到 Provider → 模型 → 思考强度菜单的纯投影与选择编排
│   ├── realtime-event-routing/  # 请求级 dispatcher、会话/turn/可见性门禁与事件去重
│   ├── reference-mention/       # @ 候选宿主扩展
│   ├── resource-link/           # 回答中三类 canonical file locator 的识别、展示与公开 port
│   ├── subrun-card/             # 完整 child message admission、Host 父进度卡与插件公开卡
│   ├── subrun-collection/       # Host batch 进度归一与插件多卡合同
│   ├── subrun-detail/           # 就地详情 scope、Header 返回意图、Host 锚点与只读状态底栏
│   ├── subrun-invocation/       # subrun 发起的公共 port
│   ├── subrun-trace/            # 子 run 过程契约、历史/增量 accumulator、durable 刷新
│   ├── summary-presentation/    # summarization_progress presentation 纯函数
│   ├── timeline/                # 全量 turn index 与窗口内/外导航
│   ├── user-input-admission/    # durable user_input ack 的唯一身份校验与接纳入口
│   └── virtualizer-spike/       # 确定性滚动回归门禁，暂不删除
├── ports/                       # 对外窄 contract
├── registrations/               # 域内注册装配
├── shared/                      # 域内共享（含 observability 与 virtualization 桥接）
├── store/                       # live 投影状态、执行状态与公开 selectors
├── styles/                      # 域内样式
├── testing/                     # 测试消息构造等测试专用工具
├── types/                       # 过宽出口，正在迁往 definitions/（AST 棘轮禁止扩张，见 12-open-risks R-13）
├── ui/
│   ├── ConversationChatSurface.vue # 空态 / Host 原子互斥的唯一领域内容 owner
│   ├── ConversationHost.vue     # 滚动宿主、timeline 与跨 feature 编排
│   ├── ConversationView.vue     # visual-row 虚拟画布接线
│   ├── messageCanvas/           # 完整消息共享 visual-row DOM、间距与行操作
│   ├── conversationView/        # 增量投影、TanStack placement adapter、滚动规则
│   ├── message/                 # 用户、答案、摘要与工具消息 leaf
│   ├── tools/                   # Renderer registry/projector 驱动的工具卡与图片工具主链
│   └── components/timeline/     # timeline 纯展示
├── utils/                       # 域内工具函数
└── docs/                        # 本目录
```
