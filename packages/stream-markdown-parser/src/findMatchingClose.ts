export function findMatchingClose(src: string, startIdx: number, open: string, close: string) {
  const len = src.length
  // Special-case $$ since it's a two-char delimiter that shouldn't
  // be interpreted as nested parentheses.
  if (open === '$$' && close === '$$') {
    let i = startIdx
    while (i < len - 1) {
      if (src[i] === '$' && src[i + 1] === '$') {
        // ensure not escaped
        let k = i - 1
        let backslashes = 0
        while (k >= 0 && src[k] === '\\') {
          backslashes++
          k--
        }
        if (backslashes % 2 === 0)
          return i
      }
      i++
    }
    return -1
  }

  const openChar = open[open.length - 1]
  const closeSeq = close
  let depth = 0
  let i = startIdx
  while (i < len) {
    // If there's an unescaped close sequence here
    if (src.slice(i, i + closeSeq.length) === closeSeq) {
      let k = i - 1
      let backslashes = 0
      while (k >= 0 && src[k] === '\\') {
        backslashes++
        k--
      }
      if (backslashes % 2 === 0) {
        if (depth === 0)
          return i
        depth--
        i += closeSeq.length
        continue
      }
    }

    const ch = src[i]
    // skip escaped characters
    if (ch === '\\') {
      i += 2
      continue
    }

    if (ch === openChar) {
      depth++
    }
    else if (ch === closeSeq[closeSeq.length - 1]) {
      if (depth > 0)
        depth--
    }
    i++
  }
  return -1
}

export default findMatchingClose
