# Agent 场景测试命令

`pnpm -s scenario` 是 Flow 场景测试的启动器：只负责找文件、传参数、生成骨架，真正执行仍是 vitest，不另起一套 runner。

场景测试用 [`createFlowScenario`](../../../../src/app-hosts/linnya/adapters/flow/__test-helpers__/flowScenario.ts) 写：真 SQLite、生产 Runtime 启动装配、Graph、Flow 编排与插话登记表，只替换上游模型和工具。读数覆盖四层：持久历史、实时事件、Renderer 实时投影、重载后的消息窗口。

```bash
pnpm -s scenario list                      # 用场景夹具写的测试与用例
pnpm -s scenario run steering --grep 暂停   # 按文件片段 / 用例名运行；默认隐藏 Runtime 日志，--verbose 保留
pnpm -s scenario fuzz --runs 200           # 随机组合（*.fuzz.*），加量或用 --seed 固定
pnpm -s scenario replay <seed> [path]      # 按失败时打印的 seed / path 复现
pnpm -s scenario new steer-after-error     # 生成最小可运行骨架
pnpm -s scenario run real-model --real-model  # 真实模型核对（调用上游、产生费用）
```

## 写一个场景

```ts
scenario = await createFlowScenario({
  model: [
    { toolCalls: [{ name: 'lookup' }] },
    { contentChunks: ['done'] },
  ],
  tools: { lookup: async () => { await scenario!.steer('只看今年的'); return 'ok'; } },
});
expect((await scenario.send('go')).status).toBe('completed');
await scenario.assertInvariants();
```

- 模型脚本与 Linnkit testkit 是同一套：回合表或按请求决定回合的函数；回合的 `assertCall` 可以异步，表示“第 N 次模型调用进行中”。
- 工具脚本里的 `await scenario.steer() / withdraw() / pause()` 表示“工具执行中”用户的动作；`pause()` 等到暂停请求被接受即返回，运行收口由 `send` / `continue` 等待。
- 脚本工具用中性名字（如 `lookup`）。借用产品工具名（如 `web_search`）会触发该工具的正式结果合同。
- `send` 返回运行状态与运行停下后取回的插话（与 Renderer 行为一致），不因运行失败抛错。
- `assertInvariants()` 检查：H1 实时投影与重载一致；H2 每条被接纳的插话恰好一个去向（送达、取回或撤回）；S1–S5 Linnkit 插话不变量（按模型实际收到的消息判断）。失败时附可读时间线。

- 场景只向模型暴露、也只执行它声明的工具（`tools` 与 `productTools`，如真实的 `ask`），不会回退到生产工具或访问网络。
- `respond(answer)` 回答运行正在等的交互；等待用户时插话不代替回答，也不会被当成运行停下取回。

## 真实模型核对

`createRecordedRealModelInference(modelId)` 走生产的模型调用链，用当前 checkout 开发实例已经配置好的模型和凭据：模型与 Provider 配置（不含密钥）复制进临时 workspace，凭据由 Linnya 凭据存储直接只读开发 profile，不复制、不输出。见 [`realModelInference.ts`](../../../../src/app-hosts/linnya/adapters/flow/__test-helpers__/realModelInference.ts)。

这类测试默认跳过，`--real-model`（或 `LINNYA_REAL_MODEL_TEST=1`）才运行；`LINNYA_REAL_MODEL_IDS` 选 Provider 模型名，`LINNYA_REAL_MODEL_REPORT=<文件>` 写出每个模型的时间线。真实模型不保证每次走同一条路，断言只写“必须成立”的结果（插话已送达、模型读到了、多轮能接上），不写死时间线。

随机组合测试只写“任何组合都必须成立的性质”，不写死时间线；默认次数小，日常 CI 里只花几秒。失败时 fast-check 会缩小到最小反例并打印 seed / path。
