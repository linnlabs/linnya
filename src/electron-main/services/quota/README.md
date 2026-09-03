### Quota（通用配额）模块

> 说明：本目录只讲 **“配额能力”本身的设计与约定**，不讲具体业务（Deep Research/导出/上传等）。
>
> 目标：让“新增一个配额”只需要 **加一条 policy + 一处调用**，避免出现 `xxx-ipc.ts` 越来越多、散落越来越广的维护问题。

---

## 1. 核心概念

- **QuotaPolicy（策略）**
  - `quotaId`：配额的唯一标识（建议 snake_case，例如 `deep_research`）
  - `windowType`：窗口类型（当前仅实现 `iso_week`）
  - `limit`：窗口内允许的最大次数
  - `storeKey`：electron-store 的持久化 key（必须带版本号，便于迁移）

- **QuotaState（状态，落盘）**
  - `windowKey`：窗口 key（`iso_week` 对应 `YYYY-WW`）
  - `usedCount`：已使用次数
  - `updatedAt`：最后更新时间戳（ms）

- **QuotaInfo / QuotaConsumeInfo（对外输出）**
  - `isExceeded`：是否已超限
  - `resetAt`：下个窗口开始的时间戳（ms）
  - `allowed`（仅 consume 返回）：本次是否允许消费

---

## 2. 目录结构与职责

- **`quotaManager.ts`**
  - 配额的唯一执行入口：`getQuotaInfo()` / `consume()`
  - 负责：窗口 key 计算、状态读写、结构化校验（禁止 any）

- **`quotaRegistry.ts`**
  - QuotaManager 单例与“内置策略”注册入口
  - 约束：所有配额策略必须集中在这里注册（避免散落到 IPC 或业务模块）
  - 兼容：包含必要的数据迁移逻辑（例如旧 storeKey → 新 storeKey）

---

## 3. IPC 协议（主进程）

通用 IPC（由 `src/electron-main/ipc/handlers/system/quota-ipc.ts` 注册）：

- **`quota:get`**
  - 入参：`{ quotaId: string }`
  - 返回：`QuotaInfo | { success:false; error:string }`

- **`quota:consume`**
  - 入参：`{ quotaId: string }`
  - 返回：`QuotaConsumeInfo | { success:false; error:string }`

安全约束：
- 渲染进程只能通过 preload allowlist 调用（见 `src/electron-main/preload/valid-channels.ts` 的 `QUOTA_CHANNELS`）

---

## 4. 渲染端调用方式（统一入口）

渲染端通用 client：
- `apps/renderer/shared/quota/quotaClient.ts`

业务侧示例（伪代码）：

```ts
import { consumeQuotaOrNull } from '@/shared/quota/quotaClient';

const res = await consumeQuotaOrNull('deep_research');
if (res?.success === true && 'allowed' in res && res.allowed === false) {
  // UI 提示：到达上限 + resetAt
}
```

---

## 5. 新增一个配额（推荐流程）

1) 在 `quotaRegistry.ts` 添加 policy：
- 选择 `quotaId`
- 确定窗口类型（目前只支持 `iso_week`）
- 设置 `limit`
- 设置带版本号的 `storeKey`

2) 在业务入口调用 `consumeQuotaOrNull(quotaId)`（或先 `getQuotaOrNull()` 再展示 UI）

3) 若是“从旧实现迁移过来”的配额：
- 在 `quotaRegistry.ts` 增加一次性迁移逻辑（仅当新 key 不存在时迁移）
- **不要**在业务侧写迁移（迁移属于配额域的职责）

---

## 6. 约束与边界

- **隐私与安全**
  - 配额状态只存计数与窗口信息，不存用户内容
  - IPC 入参必须做结构化校验（禁止 any）

- **可扩展性**
  - 未来可新增 `windowType`（例如 `local_day` / `rolling_7d`），只扩展 QuotaManager 的窗口计算函数
  - 不应新增新的 `xxx:consume` channel；统一走 `quota:*`

