/**
 * 可复现的随机数：编号 `pl` + 4 位 36 进制就是种子本身，传回同一编号即可复现同一组结果。
 */

const RNG_ALPHABET_SIZE = 36
const RNG_ID_LENGTH = 4
const RNG_SPACE = RNG_ALPHABET_SIZE ** RNG_ID_LENGTH
const RNG_ID_PATTERN = /^pl([0-9a-z]{4})$/

export type RandomSource = () => number

/** mulberry32：小而均匀，足够用于抽取与微调。返回 [0, 1)。 */
export function createRandom(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function encodeRngId(seed: number): string {
  return `pl${(seed % RNG_SPACE).toString(RNG_ALPHABET_SIZE).padStart(RNG_ID_LENGTH, '0')}`
}

/** 解析之前输出的编号；不是本系统的编号时返回 null。 */
export function decodeRngId(id: string): number | null {
  const match = RNG_ID_PATTERN.exec(id.trim().toLowerCase())
  return match?.[1] ? Number.parseInt(match[1], RNG_ALPHABET_SIZE) : null
}

export function freshSeed(): number {
  const values = new Uint32Array(1)
  globalThis.crypto.getRandomValues(values)
  return (values[0] ?? 0) % RNG_SPACE
}

export function randomBetween(random: RandomSource, min: number, max: number): number {
  return min + (max - min) * random()
}
