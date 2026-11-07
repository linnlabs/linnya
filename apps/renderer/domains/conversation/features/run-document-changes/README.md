# Run Document Changes

一轮回复结束后，在回答末尾的 tail 区域列出这轮运行（含子任务）改过的文档。运行中不显示，
每次写入仍由工具卡逐条展示。只在主时间线开启（`showsRunDocumentChanges`），Subrun 详情不列。

## 展示

- 收起：tail 首行左侧一行小字“改了 N 份文档 · M 份待审阅”，与右侧转存 / 复制同一行；默认收起。
  只改了一份时不折叠，直接写“改了《标题》 · 状态”，点击即打开或进入审阅。
- 展开：每份一行，图标、标题、“新建 / 修改”（只有子任务改过时写“子任务新建 / 修改”），右侧是状态词和按钮。
  待审阅的排最前，其余最近改动在前；先列 7 份，其余点“再显示”。
- 已工作时长：有改动清单时放在清单最下面；没有改动时仍居中在 tail 首行。
- 已删除或文档类型未启用的行变灰、不可点。
- 层级只靠字号、字重、字色深浅，不加色块、边框或彩色标记。

## 状态与打开

每份文档只显示它自己类型的状态，点进去是它自己的审阅或历史，没有统一的“接受 / 撤回”：

| 状态 | 来源 | 行尾按钮 |
| --- | --- | --- |
| `N 处待审阅` | Markdown 当前待审阅修订数 | 审阅：打开文档，修订在编辑器里处理 |
| `已生效` | 改了已有文档、类型提供文档历史（目前 Slides） | 历史：打开文档并弹出文档历史 |
| 无 | 新建的文档、其他类型 | 无，点整行打开 |

状态是当前事实：文档改名、删除或修订被处理时（Workspace mutation 事件）重读，处理完修订后“待审阅”消失。

## 边界

- `definitions/`：展示用条目与 `RunDocumentChangesPort`。Conversation 不解释文档类型，状态由 port 实现给出。
- `orchestration/useRunDocumentChanges`：本轮结束后读取、订阅刷新、打开失败提示。
- `store/`：按“会话 + 运行”缓存结果与展开状态，虚拟列表重挂载时同步拿到上次结果。
- `ui/`：尾注与清单两个展示组件，由 `ConversationVisualRow` 放进 tail 区域。
- port 实现位于 `apps/renderer/app/workflows/conversation-run-document-changes/`：调用
  [Host 读取用例](../../../../../../src/app-hosts/linnya/application/run-document-changes/README.md)，按文档类型注册表决定图标、
  能否打开以及走审阅还是历史；历史面板由顶栏通过 `requestDocumentHistoryPanel` 打开。
- 未注册 port（夹具、单测）时不显示，也不依赖 Pinia。

```bash
pnpm exec vitest run --config vitest.renderer.config.ts apps/renderer/domains/conversation/features/run-document-changes apps/renderer/app/workflows/conversation-run-document-changes
```
