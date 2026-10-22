import { describe, expect, it } from 'vitest'
import { mixColors, parseColor, readableTextOn, withAlpha } from './chartPalette'

describe('parseColor', () => {
  it('解析 #RRGGBB 与 #RGB', () => {
    expect(parseColor('#336699')).toEqual({ channels: [51, 102, 153], alpha: 1 })
    expect(parseColor('#fa0')).toEqual({ channels: [255, 170, 0], alpha: 1 })
  })

  it('解析浏览器里 token 经 canvas 解析后的 rgb()/rgba()', () => {
    expect(parseColor('rgb(23, 23, 23)')).toEqual({ channels: [23, 23, 23], alpha: 1 })
    expect(parseColor('rgba(255, 255, 255, 0.16)')).toEqual({ channels: [255, 255, 255], alpha: 0.16 })
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual({ channels: [1, 2, 3], alpha: 0.5 })
  })

  it('不认识的写法返回 null，而不是猜一个颜色', () => {
    expect(parseColor('red')).toBeNull()
    expect(parseColor('var(--color-text-primary)')).toBeNull()
    expect(parseColor('')).toBeNull()
  })
})

describe('withAlpha', () => {
  it('对十六进制与 rgb() 都叠加透明度', () => {
    expect(withAlpha('#336699', 0.1)).toBe('rgba(51, 102, 153, 0.1)')
    expect(withAlpha('rgb(23, 23, 23)', 0.05)).toBe('rgba(23, 23, 23, 0.05)')
  })

  it('已有透明度相乘，不会被覆盖成不透明', () => {
    expect(withAlpha('rgba(255, 255, 255, 0.16)', 0.5)).toBe('rgba(255, 255, 255, 0.08)')
  })

  it('不认识的颜色宁可不画（transparent），也不画成不透明的色块', () => {
    expect(withAlpha('red', 0.05)).toBe('transparent')
  })
})

describe('mixColors / readableTextOn', () => {
  it('rgb() 输入同样可以混色', () => {
    expect(mixColors('rgb(0, 0, 0)', 'rgb(255, 255, 255)', 0.5)).toBe('#808080')
  })

  it('按填充明度选择文字色：浅填充用墨色，深填充用白色（rgb() 填充同样适用）', () => {
    expect(readableTextOn('#f2f2f2')).toBe('#0b0b0b')
    expect(readableTextOn('rgb(20, 20, 20)')).toBe('#ffffff')
    expect(readableTextOn('rgb(240, 240, 240)')).toBe('#0b0b0b')
  })
})
