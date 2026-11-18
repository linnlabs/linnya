# Agent 场景测试命令

`pnpm -s scenario` 是 Flow 场景测试的启动器：只负责找文件、传参数、生成骨架，真正执行仍是 vitest，不另起一套 runner。

场景测试用 [`createFlowScenario`](../../../../src/app-hosts/linnya/adapters/flow/__test-helpers__/flowScenario.ts) 写：真 SQLite、生产 Runtime 启动装配、Graph、Flow 编排与插话登记表，只替换上游模型和工具。读数覆盖四层：持久历史、实时事件、Renderer 实时投影、重载后的消息窗口。

```bash
pnpm -s scenario list                      # 用场景夹具写的测试与用例
pnpm -s scenario run steering --grep 暂停   # 按文件片段 / 用例名运行；默认隐藏 Runtime 日志，--verbose 保留
pnpm -s scenario fuzz --runs 200           # 随机组合（*.fuzz.*），加量或用 --seed 固定
pnpm -s scenario replay <seed> [path]      # 按失败时打印的 seed / path 复现
pnpm -s scenario new steer-after-error     # 生成最小可运行骨架
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

随机组合测试只写“任何组合都必须成立的性质”，不写死时间线；默认次数小，日常 CI 里只花几秒。失败时 fast-check 会缩小到最小反例并打印 seed / path。
