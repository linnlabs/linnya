// composables/useOneShotEntryAnimation.ts
import { onMounted, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useUIStore } from '../stores/ui'

/**
 * 为单个元素提供「一次性入场动画」能力：
 * - 仅在首次可见时判定并可能播放；
 * - 布局过渡进行中时抑制老消息动画；
 * - 可选择让"过渡期间新消息"延迟到过渡结束后再播放；
 */
export function useOneShotEntryAnimation(
  elRef: Ref<HTMLElement | null | undefined>,
  opts?: {
    /** 可选：消息的稳定 id。若存在虚拟列表反复卸载/挂载，建议提供，以防重复播。 */
    id?: string | number
    /** 过渡期间新消息是否延迟到过渡结束后再播（默认 true） */
    deferDuringLayout?: boolean
    /** 动画参数 */
    durationMs?: number
    distancePx?: number
    easing?: string
  }
) {
  const {
    id,
    deferDuringLayout = true,
    durationMs = 220,
    distancePx = 8,
    easing = 'cubic-bezier(.2,.7,.2,1)',
  } = opts ?? {}

  const ui = useUIStore()
  const played = ref(false)
  const mountedAt = performance.now()

  // 可选：跨组件记忆（防虚拟列表重复播放）
  const globalPlayed = getGlobalPlayedSet()
  if (id != null && globalPlayed.has(id)) {
    played.value = true
  }

  let stopWatch: (() => void) | null = null
  let io: IntersectionObserver | null = null

  function markPlayed() {
    played.value = true
    if (id != null) globalPlayed.add(id)
  }

  function applyInitialStyles(el: HTMLElement) {
    // 预设初始样式，避免先显示再瞬间隐藏造成的抖动
    el.style.opacity = '0'
    el.style.transform = `translateY(${distancePx}px)`
  }

  function clearInlineStyles(el: HTMLElement) {
    // 动画完成后清理内联样式，回归自然布局
    el.style.opacity = ''
    el.style.transform = ''
  }

  function playNow() {
    const el = elRef.value as HTMLElement | null
    if (!el || played.value) return
    // 无障碍：尊重"减少动态效果"设置
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      markPlayed()
      return
    }

    // 先设置初始样式，下一帧再启动动画，避免首帧抖动
    applyInitialStyles(el)
    requestAnimationFrame(() => {
      const anim = el.animate(
        [
          { opacity: 0, transform: `translateY(${distancePx}px)` },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: durationMs, easing, fill: 'forwards' }
      )
      anim.onfinish = () => {
        clearInlineStyles(el)
      }
      markPlayed()
    })
  }

  function decideAndMaybePlay() {
    if (played.value) return

    // 正在进行侧边栏布局过渡
    if (ui.isSidebarTransitioning) {
      // 这个消息是否在过渡开始前就已经存在（= 老消息）
      const existedBeforeTransition = mountedAt < ui.transitionStartedAt

      if (existedBeforeTransition) {
        // 需求2：老消息仅随布局移动，不播放入场动画
        markPlayed()
        return
      }

      // 过渡期间插入的新消息
      if (deferDuringLayout) {
        // 为避免等待期间闪烁，先预设初始样式
        const el = elRef.value
        if (el) applyInitialStyles(el)
        // 等过渡结束后再播
        stopWatch = watch(
          () => ui.isSidebarTransitioning,
          (running) => {
            if (!running) {
              playNow()
              stopWatch?.()
              stopWatch = null
            }
          },
          { immediate: true }
        )
        return
      } else {
        // 也可以选择立即播（若你希望过渡期间的新消息马上淡入）
        playNow()
        return
      }
    }

    // 非过渡期：正常入场
    playNow()
  }

  onMounted(() => {
    const el = elRef.value
    if (!el) return

    // 仅当元素进入视口后再做决策（避免不可见时白播）
    io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting) {
          io?.disconnect()
          io = null
          // 双 RAF 确保布局稳定后再判定，避免抖动
          requestAnimationFrame(() => requestAnimationFrame(decideAndMaybePlay))
        }
      },
      { root: null, threshold: 0 }
    )
    io.observe(el)
  })

  onBeforeUnmount(() => {
    io?.disconnect()
    io = null
    stopWatch?.()
    stopWatch = null
  })

  return { played } // 若需要在模板上做点样式区分可用
}

// 模块级别弱引用记忆（简单实现）
const _playedIds = new Set<string | number>()
function getGlobalPlayedSet() {
  return _playedIds
} 