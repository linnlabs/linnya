// @vitest-environment jsdom
import { createApp, defineComponent, h, ref, shallowRef } from 'vue'
import { expect, it } from 'vitest'
import { evaluateChartSource } from '../functions/chartSourceDraft'
import { useChartEditDraft } from './useChartEditDraft'

it('外部修改或进入修订后保留草稿，但确认不能覆盖较新的内容', () => {
  const evaluation = evaluateChartSource('{"chartType":"bar","categories":["A"],"series":[{"name":"S","values":[1]}]}')
  if (evaluation.kind !== 'valid') throw new Error('fixture invalid')
  const currentSpec = shallowRef(evaluation.spec)
  const blocked = ref(false)
  let draft: ReturnType<typeof useChartEditDraft> | undefined
  const host = document.createElement('div')
  const app = createApp(defineComponent({ setup() {
    draft = useChartEditDraft({ initialSpec: currentSpec.value, currentSpec, blocked })
    return () => h('div')
  } }))
  app.mount(host)
  try {
    if (!draft) throw new Error('draft not mounted')
    const edited = evaluation.canonicalText.replace('"A"', '"读者草稿"')
    draft.setSource(edited)
    expect(draft.confirm()).not.toBeNull()
    currentSpec.value = { ...currentSpec.value, title: 'Agent 更新' }
    expect(draft.confirm()).toBeNull()
    expect(draft.sourceText.value).toBe(edited)
    currentSpec.value = evaluation.spec
    blocked.value = true
    expect(draft.canConfirm.value).toBe(false)
    expect(draft.confirm()).toBeNull()
  } finally { app.unmount() }
})
