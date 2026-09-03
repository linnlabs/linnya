# Engine Execution

Slides engine 业务执行 adapter 归属在这里。compile / parse / patch / inspect / export / preview / render-model 统一通过可替换边界调用；其中生产 `DeckAssemblerPort` 由 `features/presentationBuildExecution` 注入，PPTX/ZIP 同步计算不会在该 adapter 的调用线程执行。

## 边界

- `InProcessSlidesEngineExecutionAdapter` 只依赖 `backend/engine/types.ts` 里的窄 port。
- adapter 不 import host `src/`、DB、workspace、IPC、coordinator 具体类或 renderer 代码。
- 查询派生通过 `SlidesPresentationQueryPort` 注入；当前包内 `PptPresentationQueryService` 是 in-process 查询实现。generated 查询直接消费持久化层已经校验和迁移完成的 DeckSpec，禁止在查询阶段再次经过工具输入 normalizer。
- 版本保存、workspace 更新和插件启停门禁仍属于上层 orchestration / hook / IPC，不下沉到 adapter。

当前不把整个 engine adapter 粗暴搬进通用 Worker：查询、持久化和资产授权仍由业务 orchestration 拥有，只有可信同步 CPU 进入 Slides 自有 build Worker。未来若 Worker Thread 需要升级为 headless compute child，替换 build execution port 的物理实现即可，不改变本 adapter 或 UI 合同。
