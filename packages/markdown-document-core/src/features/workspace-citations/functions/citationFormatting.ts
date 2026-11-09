/** 文献条目的作者和年份由 Editor 与只读预览共用，语言只由调用方提供。 */
export function formatBibliographyAuthors(authors: ReadonlyArray<string>, othersSuffix: string): string {
  if (authors.length === 0) return ''
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`
  return `${authors[0]} ${othersSuffix}`
}

export function formatCitationDate(date: string): string {
  const yearMatch = date.match(/\d{4}/)
  return yearMatch ? yearMatch[0] : date
}
