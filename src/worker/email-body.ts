import sanitizeHtml from 'sanitize-html'
import postcss from 'postcss'
import type { RawMessage, RawPart } from '../gmail/gmail.ts'

export function getHeader(part: RawPart | undefined, name: string): string {
  return part?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function decode(data: string | undefined, part: RawPart): string {
  if (!data) return ''
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  const charset = getHeader(part, 'Content-Type').match(/charset\s*=\s*"?([^";\s]+)/i)?.[1] ?? 'utf-8'
  // Gmail's parsed payload can contain UTF-8 bytes even when the original MIME
  // header still declares ISO-2022-JP. Keep real escape-sequence mail intact.
  if (/^iso-2022-jp$/i.test(charset) && bytes.includes(0x1b)) {
    return new TextDecoder(charset).decode(bytes)
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch {
    try { return new TextDecoder(charset).decode(bytes) }
    catch { return new TextDecoder().decode(bytes) }
  }
}

const emailCssProperties = new Set([
  'color', 'background-color', 'font-size', 'font-family', 'font-weight', 'font-style',
  'line-height', 'text-align', 'text-decoration', 'vertical-align', 'display', 'opacity',
  'width', 'height', 'max-width', 'min-width', 'border', 'border-top', 'border-right',
  'border-bottom', 'border-left', 'border-collapse', 'border-spacing', 'padding',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
])

function sanitizeEmailCss(input: string) {
  try {
    const root = postcss.parse(input.replace(/<!--|-->/g, ''))
    root.walkComments(comment => { comment.remove() })
    root.walkAtRules(rule => {
      if (rule.name.toLowerCase() !== 'media' || !/^[\w\s():.,%-]{1,200}$/.test(rule.params)) rule.remove()
    })
    root.walkRules(rule => {
      if (rule.selector.length > 500 || /[<>]|url\s*\(/i.test(rule.selector)) rule.remove()
    })
    root.walkDecls(declaration => {
      if (!emailCssProperties.has(declaration.prop.toLowerCase()) || declaration.value.length > 500 || /[<>]|url\s*\(|expression\s*\(|@import|\\/i.test(declaration.value)) declaration.remove()
    })
    return root.toString().replace(/</g, '\\3C ')
  } catch { return '' }
}

export function extractBody(raw: RawMessage, loadImages = false) {
  const found: { html: string; text: string } = { html: '', text: '' }
  function visit(part: RawPart | undefined) {
    if (!part) return
    if (!part.body?.attachmentId && !/^attachment\b/i.test(getHeader(part, 'Content-Disposition')) && part.body?.data) {
      if (part.mimeType === 'text/html' && !found.html) found.html = decode(part.body.data, part)
      if (part.mimeType === 'text/plain' && !found.text) found.text = decode(part.body.data, part)
    }
    part.parts?.forEach(visit)
  }
  visit(raw.payload)
  const css = [...found.html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .map(match => sanitizeEmailCss(match[1])).filter(Boolean).join('\n')
  const imageCount = (found.html.match(/<img\b/gi) ?? []).length
  const color = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i
  const length = /^(?:0|\d+(?:\.\d+)?(?:px|em|rem|%|pt|vh|vw))$/i
  const spacing = /^(?:0|\d+(?:\.\d+)?(?:px|em|rem|%|pt))(?:\s+(?:0|\d+(?:\.\d+)?(?:px|em|rem|%|pt))){0,3}$/i
  const html = found.html ? sanitizeHtml(found.html, {
    allowedTags: [...new Set([...sanitizeHtml.defaults.allowedTags.filter(tag => tag !== 'img'), 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'span', ...(loadImages ? ['img'] : [])])],
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title'], '*': ['class', 'align', 'width', 'height', 'colspan', 'rowspan', 'style'] },
    allowedSchemesByTag: { img: ['https'] },
    allowedStyles: { '*': {
      color: [color], 'background-color': [color], 'font-family': [/^[\w\s,'"-]+$/],
      'font-size': [length], 'font-weight': [/^(?:normal|bold|[1-9]00)$/i],
      'font-style': [/^(?:normal|italic)$/i], 'line-height': [length, /^\d+(?:\.\d+)?$/],
      'text-align': [/^(?:left|right|center|justify|start|end)$/i],
      'text-decoration': [/^(?:none|underline|line-through)$/i],
      'vertical-align': [/^(?:top|middle|bottom|baseline)$/i],
      width: [length, /^auto$/i], 'max-width': [length, /^none$/i],
      height: [length, /^auto$/i],
      padding: [spacing], 'padding-top': [length], 'padding-right': [length], 'padding-bottom': [length], 'padding-left': [length],
      margin: [spacing, /^auto$/i], 'margin-top': [length, /^auto$/i], 'margin-right': [length, /^auto$/i], 'margin-bottom': [length, /^auto$/i], 'margin-left': [length, /^auto$/i],
      'border-collapse': [/^(?:collapse|separate)$/i],
      'border-spacing': [spacing],
    } },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    transformTags: { a: (_tag, attrs) => ({ tagName: 'a', attribs: { ...attrs, target: '_blank', rel: 'noopener noreferrer' } }) },
  }) : ''
  return { html, text: found.text, css, imageCount }
}
