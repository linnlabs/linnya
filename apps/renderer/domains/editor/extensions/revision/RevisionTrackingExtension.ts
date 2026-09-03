/**
 * @file RevisionTrackingExtension.ts
 * @description 已禁用的 Track Changes 占位扩展。
 *
 * 统一 `revision === pending` 后，任何修订都必须先进入块级 pending，
 * 再由 pending 投影为 `revisionMark`。因此这里不允许继续直写 doc。
 *
 * 保留本文件仅为了：
 * - 维持历史 import 路径稳定；
 * - 明确告诉后续开发者：Track Changes 不在当前产品主线内。
 */

import { Extension } from '@tiptap/core'

export const RevisionTrackingExtension = Extension.create({
  name: 'revisionTracking',
})

export default RevisionTrackingExtension
