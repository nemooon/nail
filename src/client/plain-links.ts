export type PlainSegment = { text: string; href?: string }

const urlPattern = /https?:\/\/[^\s<>"'`]+/gi
const trailingPunctuation = /[.,;:!?)。、，．！？）」』〉》]/u

function trimUrl(value: string) {
  let end = value.length
  while (end > 0) {
    const last = value[end - 1]
    if (last === ')' && (value.slice(0, end).match(/\)/g) ?? []).length <= (value.slice(0, end).match(/\(/g) ?? []).length) break
    if (last === ']' && (value.slice(0, end).match(/\]/g) ?? []).length <= (value.slice(0, end).match(/\[/g) ?? []).length) break
    if (last === '}' && (value.slice(0, end).match(/\}/g) ?? []).length <= (value.slice(0, end).match(/\{/g) ?? []).length) break
    if (!trailingPunctuation.test(last) && last !== ']' && last !== '}') break
    end--
  }
  return value.slice(0, end)
}

export function linkifyPlainText(input: string): PlainSegment[] {
  const segments: PlainSegment[] = []
  let cursor = 0
  for (const match of input.matchAll(urlPattern)) {
    const candidate = trimUrl(match[0])
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) continue
    } catch { continue }
    if (match.index > cursor) segments.push({ text: input.slice(cursor, match.index) })
    segments.push({ text: candidate, href: candidate })
    cursor = match.index + candidate.length
  }
  if (cursor < input.length) segments.push({ text: input.slice(cursor) })
  return segments
}
