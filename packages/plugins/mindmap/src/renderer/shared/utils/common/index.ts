export function encodeHTML(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

export const isMobile = (): boolean => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

export const throttle = <T extends (...args: never[]) => void>(fn: T, wait: number) => {
  let pre = Date.now()
  return function (...args: Parameters<T>) {
    const now = Date.now()
    if (now - pre < wait) return
    fn(...args)
    pre = Date.now()
  }
}

export function generateUUID(): string {
  return (new Date().getTime().toString(16) + Math.random().toString(16).substr(2)).substr(2, 16)
}

