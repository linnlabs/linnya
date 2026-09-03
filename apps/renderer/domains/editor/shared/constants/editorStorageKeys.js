/**
 * editorStorageKeys.js
 *
 * 定义在 editor.storage 中用于插件间通信和共享配置的"众所周知的键"。
 * 使用 Symbol.for() 来创建全局唯一的键，避免命名冲突。
 */

/**
 * @type {symbol}
 * 用于在 editor.storage 中存储"占位符可见性谓词函数数组"的键。
 * 详情参见: src/renderer/docs/PLUGIN_INTERACTION_GUIDE.md
 */
export const PLACEHOLDER_VISIBILITY_PREDICATES_KEY = Symbol.for('placeholderVisibilityPredicates');

/**
 * @type {symbol}
 * 用于在 editor.storage 中存储根块节点类型名称 (string) 的键。
 * 例如：'rootBlock'
 * 此信息由 app 层提供，供 shared 层的工具（如 PositionResolver）消费。
 */
export const SCHEMA_ROOT_BLOCK_TYPE_NAME_KEY = Symbol.for('schemaRootBlockTypeName');

/**
 * @type {symbol}
 * 用于在 editor.storage 中存储一个谓词函数 ((nodeTypeName: string) => boolean) 的键。
 * 该函数用于判断一个节点类型名称是否属于"块内容 (block content)"。
 * 此信息由 app 层提供，供 shared 层的工具（如 PositionResolver）消费。
 */
export const SCHEMA_IS_BLOCK_CONTENT_PREDICATE_KEY = Symbol.for('schemaIsBlockContentNodePredicate');

/**
 * @type {symbol}
 * 用于在 editor.storage 中存储"流式块处理器函数数组"的键。
 * 这些处理器函数签名应为：(chunk: any, editor: Editor, pluginState: object, updatePluginState: Function) => boolean
 * 返回 true 表示 chunk 已被处理，queueProcessor 无需再处理。
 */
export const STREAMING_CHUNK_PROCESSORS_KEY = Symbol.for('streamingChunkProcessors');

// 未来可以根据需要添加更多的共享键 