import { describe, it, expect } from 'vitest'
import {
  computeTextDiff,
  computeDiffStats,
  computeTextDiffWithPositions,
  type DiffSegment,
} from './diffUtils'

/**
 * 注意：
 * - 这里的测试不是为了「精确还原库内部的 diff 细节」，
 *   而是为了验证我们在不同粒度下的整体行为是否符合预期：
 *   - 小范围改动：应产生少量 insert/delete 片段，并且保留大部分 equal。
 *   - 段落部分重写：应产生多处中等长度 insert/delete。
 *   - 整段重写：可以接受「整段 delete + 整段 insert」的结果。
 *   - 中英文皆可正常工作。
 */

function getTypes(segments: DiffSegment[]): DiffSegment['type'][] {
  return segments.map((s) => s.type)
}

describe('computeTextDiff - 中文小范围改动', () => {
  it('应在纯尾部追加时直接产生 equal + insert', () => {
    const segments = computeTextDiff('原始内容', '原始内容，新增说明')

    expect(segments).toEqual([
      { type: 'equal', text: '原始内容' },
      { type: 'insert', text: '，新增说明' },
    ])
  })

  it('应在纯中间插入时直接产生稳定的三段 diff', () => {
    const segments = computeTextDiff('今天很好', '今天真的很好')

    expect(segments).toEqual([
      { type: 'equal', text: '今天' },
      { type: 'insert', text: '真的' },
      { type: 'equal', text: '很好' },
    ])
  })

  it('应在短句中产生既有 delete 又有 insert 的差异', () => {
    const original =
      '今天开发了edit功能，很好。这个功能非常好。'
    const rewritten =
      '今天开发了edit功能，很优秀。这个功能特别优秀。\n\n（AI 模拟提示：以上内容已做轻微措辞优化，用于测试修订标记和工具栏行为。）'

    const segments = computeTextDiff(original, rewritten)
    const stats = computeDiffStats(segments)

    // 至少要有一次插入和一次删除
    expect(stats.insertCount).toBeGreaterThanOrEqual(1)
    expect(stats.deleteCount).toBeGreaterThanOrEqual(1)

    const types = getTypes(segments)
    expect(types).toContain('insert')
    expect(types).toContain('delete')

    // 末尾应该有一段包含提示语的 insert
    const lastInsert = [...segments].reverse().find((s) => s.type === 'insert')
    expect(lastInsert).toBeTruthy()
    expect(lastInsert?.text).toContain('AI 模拟提示')
  })
})

describe('computeTextDiff - 中文段落部分重写', () => {
  it('应在长段落中产生多处 insert/delete，而不是整个段落全删全插', () => {
    const original =
      '在软件工程的浩瀚星海中，代码质量是衡量一个项目能否长久生存的关键指标。许多开发者往往只关注功能的实现，而忽视了代码的可读性与可维护性。这就好比盖房子，只在乎外观是否华丽，却不管地基是否牢固。随着时间的推移，技术债务会像滚雪球一样越积越多，最终导致项目崩溃。因此，重构不仅仅是修修补补，更是一场对代码灵魂的救赎。我们需要在每一次提交中都保持警惕，让代码像诗一样优雅。'

    const rewritten =
      '在软件工程的广袤宇宙中，代码质量是衡量一个项目能否长久生存的关键指标。优秀的工程师深知，代码不仅是写给机器执行的，更是写给人类阅读的。譬如盖房子，只在乎外观是否华丽，却不管结构是否稳健且安全。随着时间的推移，技术债务会像滚雪球一样越积越多，最终导致项目坍塌。因此，重构不仅仅是修修补补，更是一场对代码灵魂的救赎。我们需要在每一次提交中都保持警惕，让代码如诗般优雅，流淌着逻辑的韵律。\n\n（AI 深度润色：已优化修辞，重构了论述逻辑，并强化了工程隐喻。）'

    const segments = computeTextDiff(original, rewritten)
    const stats = computeDiffStats(segments)

    // 段落级别改写：应有多处 insert/delete
    expect(stats.insertCount).toBeGreaterThan(1)
    expect(stats.deleteCount).toBeGreaterThan(1)

    // 不应退化成「只剩一段 delete + 一段 insert」
    expect(segments.length).toBeGreaterThan(2)
  })
})

describe('computeTextDiff - 中文长段落文本+格式改写联动场景', () => {
  it('应同时捕获词汇改写（崩溃→坍塌）和新增提示语', () => {
    const original =
      '在软件工程的浩瀚星海中，代码质量是衡量一个项目能否长久生存的关键指标。许多开发者往往只关注功能的实现，而忽视子代码的可读性与可维护性。这就好比盖房子，只在平外观是否华丽，却不管地基是否牢固。随着时间的推移，技术债务会像滚雪球一样越积越多，最终导致项目崩溃。因此，重构不仅仅是修修补补，更是一场对代码灵魂的救赎。我们需要在每一次提交中都保持警惕，让代码像诗一样优雅。'

    const rewritten =
      '在软件工程的广袤宇宙中，代码质量是衡量一个项目能否长久生存的关键指标。优秀的工程师深知，代码不仅是写给机器执行的，更是写给人类阅读的。譬如盖房子，只在乎外观是否华丽，却不管结构是否稳健且安全。随着时间的推移，技术债务会像滚雪球一样越积越多，最终导致项目坍塌。因此，重构不仅仅是修修补补，更是一场对架构与代码的体检。我们需要在每一次提交中都保持警惕，让代码如诗般优雅。\n\n（AI 提示：已同时改写文本并验证修订标记链路。）'

    const segments = computeTextDiff(original, rewritten)
    const stats = computeDiffStats(segments)

    expect(stats.insertCount).toBeGreaterThanOrEqual(2)
    expect(stats.deleteCount).toBeGreaterThanOrEqual(1)

    const hasCollapseInsert = segments.some((s) => s.type === 'insert' && s.text.includes('坍塌'))
    const hasCollapseDelete = segments.some((s) => s.type === 'delete' && s.text.includes('崩溃'))
    expect(hasCollapseInsert).toBe(true)
    expect(hasCollapseDelete).toBe(true)

    // 末尾提示语应作为插入出现
    const tailInsert = segments.find((s) => s.type === 'insert' && s.text.includes('AI 提示'))
    expect(tailInsert).toBeTruthy()
  })
})

describe('computeTextDiff - 中文整段重写', () => {
  it('在几乎完全重写的场景下，允许退化为整段 delete + 整段 insert', () => {
    const original =
      '用户体验设计的核心在于同理心。设计师必须站在用户的角度思考问题，感受他们的痛点和需求。只有深入理解用户的真实感受，才能创造出真正打动人心的产品。如果不去倾听用户的声音，闭门造车，做出来的东西再精美也只是空中楼阁。'

    const rewritten =
      '同理心是 UX 设计的灵魂基石。这要求设计者能够代入用户视角，敏锐捕捉其潜在痛点。唯有与用户产生深层共鸣，方能打造出引发情感共振的杰作。若无视用户反馈而孤芳自赏，即便作品华丽也不过是无本之木。\n\n（AI 重写：测试整段重写的 Diff 效果，观察是否过度碎片化。）'

    const segments = computeTextDiff(original, rewritten)
    const stats = computeDiffStats(segments)

    // 几乎完全重写：允许只有一处 delete 和一处 insert
    expect(stats.deleteCount).toBe(1)
    expect(stats.insertCount).toBe(1)
    expect(segments.length).toBeLessThanOrEqual(3)

    const [first, second] = segments
    expect(first.type).toBe('delete')
    expect(second.type).toBe('insert')
  })
})

describe('computeTextDiff - 英文小范围改动', () => {
  it('应能识别英文句子中的 insert/delete', () => {
    const original =
      'This feature is very good and quite important for our users.'
    const rewritten =
      'This feature is excellent and absolutely crucial for our users.\n\n(AI note: rewrote wording slightly for testing inline revision marks.)'

    const segments = computeTextDiff(original, rewritten)
    const stats = computeDiffStats(segments)

    expect(stats.insertCount).toBeGreaterThanOrEqual(1)
    expect(stats.deleteCount).toBeGreaterThanOrEqual(1)

    const joinedText = segments.map((s) => s.text).join('')
    expect(joinedText).toContain('AI note')
  })
})

describe('computeTextDiff - 英文单词拼写纠正', () => {
  it('应在英文拼写修正场景下产生合理的 insert/delete', () => {
    const original = 'This featre is reliabl and robst.'
    const rewritten =
      'This feature is reliable and robust.\n\n(AI note: fixed typos for testing diff behaviour.)'

    const segments = computeTextDiff(original, rewritten)
    const stats = computeDiffStats(segments)

    // 这个例子主要是补全漏掉的字母，所以主要是 insert
    expect(stats.insertCount).toBeGreaterThanOrEqual(1)
    // 不强制要求 delete，因为纠正漏字不需要删除
    // expect(stats.deleteCount).toBeGreaterThanOrEqual(1)

    // 合并后的文本中应包含修正后的单词
    const merged = segments.map((s) => s.text).join('')
    expect(merged).toContain('feature')
    expect(merged).toContain('reliable')
    expect(merged).toContain('robust')
  })
})

describe('computeTextDiff - 中英文混合句子', () => {
  it('应能处理中英文混合内容的部分改写', () => {
    const original =
      '这个feature非常重要, and it is very good for our users.'
    const rewritten =
      '这个feature特别关键, and it is excellent for our users.\n\n（AI 模拟提示：中英文混合句测试。）'

    const segments = computeTextDiff(original, rewritten)
    const stats = computeDiffStats(segments)

    expect(stats.insertCount).toBeGreaterThanOrEqual(1)
    expect(stats.deleteCount).toBeGreaterThanOrEqual(1)

    const merged = segments.map((s) => s.text).join('')
    // 中英文部分都应该出现在 diff 合并结果中
    expect(merged).toContain('feature')
    expect(merged).toContain('特别关键')
    expect(merged).toContain('excellent')
  })
})

describe('computeTextDiff - 英文字母大小写变化', () => {
  it('应将大小写变化视为修改（而非完全相等）', () => {
    const original = 'ApiResponse is returned by this API.'
    const rewritten =
      'APIResponse is returned by this api.\n\n(AI note: adjusted casing for testing.)'

    const segments = computeTextDiff(original, rewritten)
    const stats = computeDiffStats(segments)

    // 至少有一次插入或删除，说明大小写变化被识别为差异
    expect(stats.insertCount + stats.deleteCount).toBeGreaterThanOrEqual(1)

    const types = getTypes(segments)
    expect(types).toContain('insert')
    expect(types).toContain('delete')
  })
})

describe('computeTextDiffWithPositions', () => {
  it('应根据 basePos 正确计算片段的起止位置', () => {
    const original = 'ABCDEF'
    const rewritten = 'ABXYDEF'
    const basePos = 10

    const results = computeTextDiffWithPositions(original, rewritten, basePos)

    // 期望：删除「C」，插入「XY」，后面的内容 equal
    const deleteSegment = results.find((r) => r.type === 'delete')
    const insertSegment = results.find((r) => r.type === 'insert')

    expect(deleteSegment).toBeTruthy()
    expect(insertSegment).toBeTruthy()

    // 删除位置应在 basePos 之后
    expect(deleteSegment!.startPos).toBeGreaterThanOrEqual(basePos)
    expect(deleteSegment!.endPos).toBeGreaterThan(deleteSegment!.startPos)

    // 插入位置应与插入点一致（startPos === endPos）
    expect(insertSegment!.startPos).toBe(insertSegment!.endPos)
  })
})

