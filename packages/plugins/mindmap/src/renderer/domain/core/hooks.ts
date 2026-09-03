import type { MindMapInstance } from '../types/index'
import type { OperationMap, Operations } from './methods'

type NodeOperation = {
  [K in Operations]: ReturnType<typeof beforeHook<K>>
}

function beforeHook<T extends Operations>(
  fn: OperationMap[T],
  fnName: T
): (this: MindMapInstance, ...args: Parameters<OperationMap[T]>) => Promise<void> {
  return async function (this: MindMapInstance, ...args: Parameters<OperationMap[T]>) {
    const hook = this.before[fnName]
    if (hook) {
      const res = await hook.apply(this, args)
      if (!res) return
    }
    // 中文说明：避免 any 断言，显式声明 this 绑定与参数形状
    ;(fn as unknown as (this: MindMapInstance, ...a: Parameters<OperationMap[T]>) => unknown).apply(this, args)
  }
}

export function applyBeforeHooks(
  nodeOperation: OperationMap,
  mode: string
): NodeOperation {
  const operations = Object.keys(nodeOperation) as Array<Operations>
  const nodeOperationHooked = {} as NodeOperation
  if (mode !== 'lite') {
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i]
      nodeOperationHooked[operation] = beforeHook(nodeOperation[operation], operation)
    }
  } else {
      // If needed for lite mode, simply assign original functions or handle accordingly
      // For now, assuming hook logic is only for non-lite or following original logic
      // Original code: if (import.meta.env.MODE !== 'lite') { ... }
      // The original code left nodeOperationHooked empty if mode is lite?
      // Wait, if mode is lite, nodeOperationHooked is empty object {}, 
      // then ...nodeOperationHooked in methods will be empty, so no operations are attached?
      // Let's check original methods.ts again.
      
      // In original methods.ts:
      // const nodeOperationHooked = {} as NodeOperation
      // if (import.meta.env.MODE !== 'lite') { ... populate ... }
      // ...interact,
      // ...(nodeOperationHooked as NodeOperation),
      
      // If lite, nodeOperationHooked is {}, so nodeOperations are NOT exported in methods?
      // This seems to imply 'lite' mode might not support these operations or they are handled differently?
      // Or maybe 'nodeOperation' object itself should be used if not hooked?
      // Actually, looking at original code:
      // methods = { ...nodeOperationHooked ... }
      // If lite, these methods are missing from MindMap instance? 
      // That seems risky unless lite mode is read-only.
      // Assuming read-only for lite.
  }
  return nodeOperationHooked
}

