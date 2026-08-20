/**
 * XEP-0393: Message Styling (extended with Markdown compatibility)
 *
 * Renders styled text with support for:
 * - *bold* (XEP-0393 strong) or **bold** (Markdown strong)
 * - _italic_ (emphasis)
 * - ~strikethrough~ (XEP-0393) or ~~strikethrough~~ (Markdown)
 * - `code` (inline preformatted)
 * - ```code block``` (preformatted block)
 * - > blockquote (lines starting with >)
 * - Unordered lists (lines starting with -, +, or * followed by space), nestable
 *   by indenting two spaces per level
 * - Ordered lists (lines starting with 1., 2., etc.), likewise nestable
 * - Headings (# H1, ## H2, ### H3, #### H4)
 * - Task lists ("- [ ] todo", "- [x] done"), rendered as read-only checkboxes
 * - Tables (GFM pipe tables, with :--- / :---: / ---: alignment)
 * - URLs (auto-linked) and [label](url) labelled links
 * - @mentions (highlighted)
 * - Escape sequences (\* \_ \~ \` \> \# \[)
 *
 * The block constructs Markdown adds on top of XEP-0393 — headings, lists,
 * tables, labelled links — are gated behind the `markdown` parameter, which
 * callers wire to the user's `markdownEnabled` setting. XEP-0393's own styling
 * (emphasis, code, code fences, quotes) is the XMPP standard for styled bodies
 * and always renders.
 */

import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { findMentionRanges, findIrcPrefixRange, type MentionReference } from '@fluux/sdk'
import { Maximize2 } from 'lucide-react'
import MarkdownIt from 'markdown-it'
import { ModalShell } from '../components/ModalShell'
import { useHighlighter } from './codeHighlight'
import { getConsistentTextColor } from '../components/Avatar'
import { MessageLink } from '../components/conversation/MessageLink'

// URL regex pattern - excludes < and > to handle angle-bracketed URLs like <https://example.com>
const URL_REGEX = /(https?:\/\/[^\s<>]+[^\s<>.,;:!?)"'\]])/g

/**
 * Return every http(s) URL found in `text`, in document order, de-duplicated.
 * Shares URL_REGEX with the message renderer so URLs are detected the same way.
 * Note: this scans the raw body, so a URL inside an inline-code span or code
 * fence (which the renderer shows as non-clickable text) is still returned here
 * and remains copyable from the action sheet — an intentional, harmless surplus.
 */
export function extractLinks(text: string): string[] {
  if (!text) return []
  URL_REGEX.lastIndex = 0
  const seen = new Set<string>()
  const out: string[] = []
  let match: RegExpExecArray | null
  while ((match = URL_REGEX.exec(text)) !== null) {
    const url = match[0]
    if (!seen.has(url)) {
      seen.add(url)
      out.push(url)
    }
  }
  return out
}

// Mention regex pattern: @word (must be preceded by start or whitespace)
// Used as fallback when XEP-0372 references aren't available
// Uses Unicode property escapes (\p{L} for letters, \p{N} for numbers) to support
// all valid XMPP nicks including accented, Cyrillic, Chinese, Japanese, etc.
// The trailing lookahead rejects domain-like tokens such as "@nsa.gov" or
// "@bob.dev": without it the word run stops at the dot and only "@nsa" would be
// highlighted, splitting the domain into a fake mention plus a plain ".gov" tail.
// The lookahead also fails on shorter (backtracked) matches — the next char after
// a partial word is itself a word char — so the whole token stays plain text.
const MENTION_REGEX = /(?:^|(?<=\s))(@[\p{L}\p{N}_]+)(?![\p{L}\p{N}_]|\.[\p{L}\p{N}])/gu

// Escape sequences: \* \_ \~ \` \>
const ESCAPE_PLACEHOLDER = '\u0000'

// Markdown labelled link: [label](https://example.com). Only http(s) targets are
// linkified — a bare [text](foo) stays literal rather than becoming a link to an
// unknown scheme, which keeps javascript:/data: out of message bodies entirely.
const LABELLED_LINK_REGEX = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g

interface StyledSegment {
  type: 'text' | 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'mention'
  content: string
  /** For mentions: identifier used to generate consistent user color (nick extracted from URI or @text) */
  identifier?: string
  /** For links: the target, when it differs from the visible text (Markdown labelled links) */
  href?: string
  /** For emphasis-wrapped links (e.g. `**url**`): style applied on top of the link */
  linkStyle?: 'bold' | 'italic' | 'strike'
}

/** Mention range with optional URI for nick extraction */
interface MentionRange {
  begin: number
  end: number
  uri?: string
}

/**
 * Parse inline styling within a single line/block of text
 * @param text - The text to parse
 * @param mentionRanges - Optional XEP-0372 mention ranges with begin/end positions relative to original text
 * @param textOffset - Offset of this text segment in the original message (for mention position matching)
 */
function parseInlineStyles(
  text: string,
  mentionRanges: MentionRange[] | null = null,
  textOffset: number = 0,
  disableMentionFallback: boolean = false,
  markdown: boolean = true
): StyledSegment[] {
  const segments: StyledSegment[] = []

  // First, handle escape sequences by replacing them with placeholders
  let escaped = text
  const escapeMap: Map<string, string> = new Map()
  let escapeIndex = 0

  escaped = escaped.replace(/\\([*_~`>#[])/g, (_, char) => {
    const placeholder = `${ESCAPE_PLACEHOLDER}${escapeIndex}${ESCAPE_PLACEHOLDER}`
    escapeMap.set(placeholder, char)
    escapeIndex++
    return placeholder
  })

  // Track position in the original text for mention matching
  let currentPos = textOffset

  // Pull out Markdown labelled links before the bare-URL split, otherwise the
  // URL inside the parens gets linkified on its own and the label is left as
  // stray brackets.
  if (markdown) {
    let lastIndex = 0
    let linkMatch: RegExpExecArray | null
    LABELLED_LINK_REGEX.lastIndex = 0

    while ((linkMatch = LABELLED_LINK_REGEX.exec(escaped)) !== null) {
      if (linkMatch.index > lastIndex) {
        const before = escaped.slice(lastIndex, linkMatch.index)
        currentPos = parseUrlsAndStyles(before, segments, escapeMap, mentionRanges, currentPos, disableMentionFallback)
      }

      segments.push({
        type: 'link',
        content: restoreEscapes(linkMatch[1], escapeMap),
        href: restoreEscapes(linkMatch[2], escapeMap),
      })

      lastIndex = linkMatch.index + linkMatch[0].length
      currentPos += linkMatch[0].length
    }

    if (lastIndex > 0) {
      if (lastIndex < escaped.length) {
        parseUrlsAndStyles(escaped.slice(lastIndex), segments, escapeMap, mentionRanges, currentPos, disableMentionFallback)
      }
      return segments
    }
  }

  parseUrlsAndStyles(escaped, segments, escapeMap, mentionRanges, currentPos, disableMentionFallback)
  return segments
}

/**
 * Split a span on bare URLs, parsing mentions and inline styling in between.
 * Returns the position reached in the original message (for mention matching).
 */
function parseUrlsAndStyles(
  escaped: string,
  segments: StyledSegment[],
  escapeMap: Map<string, string>,
  mentionRanges: MentionRange[] | null,
  startPos: number,
  disableMentionFallback: boolean
): number {
  let currentPos = startPos

  // Emphasis-wrapped URLs first: **url** / *url* / _url_ / ~~url~~ / ~url~.
  // Without this pre-pass the bare-URL split folds the trailing marker into the
  // URL — the link comes out regular weight and literally includes the stars —
  // and the opening marker is left as stray text (the `**url**` bug). Emit the
  // whole thing as one styled link, then process the remainder the usual way.
  // The URL is matched lazily so a URL that ends in the same character still
  // resolves: **https://example.com/foo*bar** keeps the real asterisk.
  const wrappedUrlRE = /(\*\*|~~|\*|_|~)(https?:\/\/[^\s<>]+?)\1(?=$|[\s\p{P}])/gu
  wrappedUrlRE.lastIndex = 0

  let lastIndex = 0
  let wm: RegExpExecArray | null
  while ((wm = wrappedUrlRE.exec(escaped)) !== null) {
    if (wm.index > lastIndex) {
      currentPos = parseBareUrlsAndStyles(
        escaped.slice(lastIndex, wm.index),
        segments,
        escapeMap,
        mentionRanges,
        currentPos,
        disableMentionFallback
      )
    }

    const linkStyle = wm[1] === '_' ? 'italic' : wm[1] === '~' || wm[1] === '~~' ? 'strike' : 'bold'
    segments.push({ type: 'link', content: restoreEscapes(wm[2], escapeMap), linkStyle })
    currentPos += wm[0].length
    lastIndex = wm.index + wm[0].length
  }

  if (lastIndex > 0) {
    if (lastIndex < escaped.length) {
      parseBareUrlsAndStyles(
        escaped.slice(lastIndex),
        segments,
        escapeMap,
        mentionRanges,
        currentPos,
        disableMentionFallback
      )
    }
    return currentPos
  }

  return parseBareUrlsAndStyles(
    escaped,
    segments,
    escapeMap,
    mentionRanges,
    currentPos,
    disableMentionFallback
  )
}

/**
 * Split a span on bare URLs, parsing mentions and inline styling in between.
 * Returns the position reached in the original message (for mention matching).
 */
function parseBareUrlsAndStyles(
  escaped: string,
  segments: StyledSegment[],
  escapeMap: Map<string, string>,
  mentionRanges: MentionRange[] | null,
  startPos: number,
  disableMentionFallback: boolean
): number {
  const urlParts = escaped.split(URL_REGEX)
  let currentPos = startPos

  for (const part of urlParts) {
    if (URL_REGEX.test(part)) {
      URL_REGEX.lastIndex = 0
      segments.push({ type: 'link', content: restoreEscapes(part, escapeMap) })
      currentPos += part.length
    } else if (part) {
      // Parse mentions and styling in non-URL parts
      parseMentionsAndStyles(part, segments, escapeMap, mentionRanges, currentPos, disableMentionFallback)
      currentPos += part.length
    }
  }

  return currentPos
}

/**
 * Parse mentions and then styled text
 * Uses XEP-0372 mention ranges when available, falls back to regex detection
 */
/**
 * Extract nick identifier from a mention URI or mention text.
 * XEP-0372 URI: 'xmpp:room@conf/nick' → 'nick'
 * Regex @mention: '@alice' → 'alice'
 * IRC prefix: 'Holger' → 'Holger'
 */
function extractMentionIdentifier(uri?: string, mentionText?: string): string | undefined {
  // Try URI first (XEP-0372)
  if (uri) {
    const slashIndex = uri.indexOf('/')
    if (slashIndex !== -1) {
      return uri.slice(slashIndex + 1)
    }
    // URI without slash (e.g. @all → 'xmpp:room@conf') — no individual user
    return undefined
  }
  // Regex fallback: strip @ prefix
  if (mentionText?.startsWith('@')) {
    return mentionText.slice(1)
  }
  // IRC-style: the mention text IS the nick
  return mentionText || undefined
}

function parseMentionsAndStyles(
  text: string,
  segments: StyledSegment[],
  escapeMap: Map<string, string>,
  mentionRanges: MentionRange[] | null = null,
  textOffset: number = 0,
  disableMentionFallback: boolean = false
): void {
  // If we have XEP-0372 mention ranges, use them for precise highlighting
  if (mentionRanges && mentionRanges.length > 0) {
    const textEnd = textOffset + text.length

    // Find mentions that overlap with this text segment
    const relevantMentions = mentionRanges.filter(m =>
      m.begin < textEnd && m.end > textOffset
    )

    if (relevantMentions.length > 0) {
      // Sort by begin position
      relevantMentions.sort((a, b) => a.begin - b.begin)

      let lastEnd = 0 // Position in the text string (not original message)

      for (const mention of relevantMentions) {
        // Convert from original message positions to text positions
        const mentionStart = Math.max(0, mention.begin - textOffset)
        const mentionEnd = Math.min(text.length, mention.end - textOffset)

        // Skip if mention is completely outside this text segment
        if (mentionStart >= text.length || mentionEnd <= 0) continue

        // Add text before this mention
        if (mentionStart > lastEnd) {
          const before = text.slice(lastEnd, mentionStart)
          parseStyledText(before, segments, escapeMap)
        }

        // Add the mention with identifier for consistent coloring
        const mentionText = text.slice(mentionStart, mentionEnd)
        const identifier = extractMentionIdentifier(mention.uri, mentionText)
        segments.push({ type: 'mention', content: restoreEscapes(mentionText, escapeMap), identifier })

        lastEnd = mentionEnd
      }

      // Add remaining text after last mention
      if (lastEnd < text.length) {
        const after = text.slice(lastEnd)
        parseStyledText(after, segments, escapeMap)
      }

      return
    }
  }

  // Fallback: use regex to detect @mentions (only in room context)
  // In 1:1 chats, no nickname/knownNicks are provided, so we skip the regex fallback
  // to avoid colorizing non-mention @words like "@commit"
  if (disableMentionFallback) {
    parseStyledText(text, segments, escapeMap)
    return
  }

  const mentionParts = text.split(MENTION_REGEX)

  for (const part of mentionParts) {
    if (MENTION_REGEX.test(part)) {
      MENTION_REGEX.lastIndex = 0
      const identifier = extractMentionIdentifier(undefined, part)
      segments.push({ type: 'mention', content: restoreEscapes(part, escapeMap), identifier })
    } else if (part) {
      // Parse styling in non-mention parts
      parseStyledText(part, segments, escapeMap)
    }
  }
}

/**
 * Restore escaped characters from placeholders
 */
function restoreEscapes(text: string, escapeMap: Map<string, string>): string {
  let result = text
  escapeMap.forEach((char, placeholder) => {
    result = result.split(placeholder).join(char)
  })
  return result
}

/**
 * Parse styled text (bold, italic, strikethrough, code)
 */
function parseStyledText(
  text: string,
  segments: StyledSegment[],
  escapeMap: Map<string, string>
): void {
  // Regex for inline styles: **bold** (Markdown), *bold* (XEP-0393), _italic_,
  // ~~strike~~ (Markdown), ~strike~ (XEP-0393), `code`
  // Per XEP-0393: markers must be at word boundaries (start/end of string, whitespace, or punctuation)
  // Opening marker: not followed by whitespace
  // Closing marker: not preceded by whitespace
  // Uses lookbehind (?<=...) and lookahead (?=...) for boundary checks
  // IMPORTANT: **bold** patterns must come BEFORE *bold* patterns to match correctly,
  // and ~~strike~~ patterns before ~strike~ for the same reason
  const styleRegex = /(?<=^|[\s\p{P}])(\*\*[^\s*][^*]*[^\s*]\*\*|\*\*[^\s*]\*\*|\*[^\s*][^*]*[^\s*]\*|\*[^\s*]\*|_[^\s_][^_]*[^\s_]_|_[^\s_]_|~~[^\s~][^~]*[^\s~]~~|~~[^\s~]~~|~[^\s~][^~]*[^\s~]~|~[^\s~]~|`[^`]+`)(?=$|[\s\p{P}])/gu

  let lastIndex = 0
  let match

  while ((match = styleRegex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index)
      segments.push({ type: 'text', content: restoreEscapes(before, escapeMap) })
    }

    const styled = match[0]

    // Detect doubled markers (Markdown bold / strikethrough) vs single ones
    // (XEP-0393). The regex alternation already prefers the doubled form, so a
    // two-character marker here is unambiguously the Markdown variant.
    let type: StyledSegment['type'] = 'text'
    let inner: string

    if (styled.startsWith('**') && styled.endsWith('**')) {
      // Markdown-style bold: **text**
      type = 'bold'
      inner = styled.slice(2, -2)
    } else if (styled.startsWith('~~') && styled.endsWith('~~')) {
      // Markdown-style strikethrough: ~~text~~
      type = 'strike'
      inner = styled.slice(2, -2)
    } else {
      // XEP-0393 style: single character markers
      const marker = styled[0]
      inner = styled.slice(1, -1)

      if (marker === '*') type = 'bold'
      else if (marker === '_') type = 'italic'
      else if (marker === '~') type = 'strike'
      else if (marker === '`') type = 'code'
    }

    segments.push({ type, content: restoreEscapes(inner, escapeMap) })
    lastIndex = match.index + styled.length
  }

  // Add remaining text (or entire text if no matches)
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: restoreEscapes(text.slice(lastIndex), escapeMap) })
  }
}

/**
 * Render a styled segment to React elements
 */
function renderSegment(segment: StyledSegment, index: number, isDarkMode?: boolean, resolveMentionColor?: (identifier: string) => string | undefined): React.ReactNode {
  switch (segment.type) {
    case 'bold':
      return <strong key={index} className="font-semibold">{segment.content}</strong>
    case 'italic':
      return <em key={index}>{segment.content}</em>
    case 'strike':
      return <del key={index} className="line-through opacity-70">{segment.content}</del>
    case 'code':
      return (
        <code
          key={index}
          className="bg-fluux-bg/50 text-fluux-brand px-1.5 py-0.5 rounded text-sm font-mono"
        >
          {segment.content}
        </code>
      )
    case 'link': {
      // Labelled links carry the target in `href` and the visible text in
      // `content`; bare URLs put the URL in `content` and MessageLink shows it.
      const link = segment.href
        ? <MessageLink key={index} href={segment.href}>{segment.content}</MessageLink>
        : <MessageLink key={index} href={segment.content} />
      // Emphasis-wrapped links (**url**, _url_, ~url~) render the link snippet
      // itself bold / italic / struck-through.
      if (segment.linkStyle === 'bold') {
        return <strong key={index} className="font-semibold">{link}</strong>
      }
      if (segment.linkStyle === 'italic') return <em key={index}>{link}</em>
      if (segment.linkStyle === 'strike') {
        return <del key={index} className="line-through opacity-70">{link}</del>
      }
      return link
    }
    case 'mention': {
      // Use per-user consistent color when identifier is available, otherwise fall back to brand.
      // Prefer the caller's resolver (which mirrors the sender-name color, including a roster
      // contact's XEP-0392 color) so the mention pill matches the person's displayed color;
      // fall back to the nick hash when no resolver is supplied or it can't resolve the nick.
      const color = segment.identifier
        ? (resolveMentionColor?.(segment.identifier) ?? getConsistentTextColor(segment.identifier, isDarkMode ?? true))
        : undefined
      const style = color
        ? { color, backgroundColor: `${color}15` }
        : undefined
      const className = color
        ? 'px-1 rounded font-medium'
        : 'text-fluux-brand bg-fluux-brand/10 px-1 rounded font-medium'
      return (
        <span
          key={index}
          className={className}
          style={style}
          data-mention={segment.identifier || ''}
        >
          {segment.content}
        </span>
      )
    }
    default:
      return segment.content
  }
}

import { copyToClipboard } from './clipboard'

/** Copy button with checkmark feedback */
function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`p-1 rounded hover:bg-fluux-hover text-fluux-muted hover:text-fluux-text transition-colors ${className}`}
      title={copied ? 'Copied!' : 'Copy code'}
    >
      {copied ? (
        <svg className="size-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  )
}

/** Rendered code content (plain or syntax-highlighted) */
function CodeContent({ code, highlightedHtml }: { code: string; highlightedHtml: string | null }) {
  return highlightedHtml ? (
    <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
  ) : (
    <code>{code}</code>
  )
}

/** Expanded code modal — fullscreen on mobile, large centered panel on desktop */
function CodeExpandModal({
  code,
  language,
  highlightedHtml,
  onClose,
}: {
  code: string
  language?: string
  highlightedHtml: string | null
  onClose: () => void
}) {
  return createPortal(
    <ModalShell
      title={language || 'Code'}
      onClose={onClose}
      width="max-w-5xl"
      panelClassName="max-h-dvh md:max-h-[90vh] h-dvh md:h-auto !mx-0 !rounded-none md:!mx-4 md:!rounded-lg flex flex-col"
    >
      <div className="flex-1 overflow-auto min-h-0">
        <pre className="bg-fluux-bg/50 text-fluux-text px-4 py-3 overflow-x-auto font-mono text-sm min-h-full">
          <CodeContent code={code} highlightedHtml={highlightedHtml} />
        </pre>
      </div>
      <div className="flex justify-end px-3 py-2 border-t border-fluux-hover flex-shrink-0">
        <CopyButton text={code} />
      </div>
    </ModalShell>,
    document.body,
  )
}

/**
 * Code block component with copy button, expand button, and syntax highlighting
 */
function CodeBlock({ code, language, keyProp }: { code: string; language?: string; keyProp: string }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const { ready, highlight } = useHighlighter(language)

  const highlightedHtml = ready && language ? highlight(code, language) : null

  return (
    <>
      <div key={keyProp} className="my-1 rounded-lg overflow-hidden border border-fluux-border">
        {/* Header bar with language label, expand and copy buttons */}
        <div className="flex items-center justify-between px-2 bg-fluux-sidebar border-b border-fluux-border">
          {language ? (
            <span className="text-xs text-fluux-muted select-none py-1">{language}</span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="p-1 rounded hover:bg-fluux-hover text-fluux-muted hover:text-fluux-text transition-colors"
              title="Expand code"
            >
              <Maximize2 className="size-3.5" />
            </button>
            <CopyButton text={code} />
          </div>
        </div>
        {/* Code content */}
        <pre className="bg-fluux-bg/50 text-fluux-text px-3 py-2 overflow-x-auto font-mono text-sm">
          <CodeContent code={code} highlightedHtml={highlightedHtml} />
        </pre>
      </div>
      {expanded && (
        <CodeExpandModal
          code={code}
          language={language}
          highlightedHtml={highlightedHtml}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  )
}

/**
 * Check if a line is a blockquote (starts with > )
 */
function isBlockquote(line: string): { isQuote: boolean; depth: number; content: string } {
  // Quote depth is the number of leading ">" markers, whether written
  // contiguously (">>") or spaced ("> >"). The trailing space before the
  // content is optional. This keeps deeper levels from leaking a literal ">"
  // into the rendered text.
  const match = line.match(/^((?:>[ \t]?)+)(.*)$/)
  if (match) {
    const depth = (match[1].match(/>/g) || []).length
    return { isQuote: true, depth, content: match[2] }
  }
  return { isQuote: false, depth: 0, content: line }
}

interface QuoteEntry { depth: number; content: string; offset: number }

/**
 * Recursively render a group of consecutive quote lines into nested
 * <blockquote> elements, one level of nesting per quote depth.
 *
 * @param entries - Consecutive quote lines with their depth and content
 * @param currentDepth - The depth this blockquote represents (1 = outermost)
 * @param baseIdx - Base key index for stable React keys
 * @param renderLine - Renders the inline content of a single quote line
 * @param decorateOutermost - When true the outermost level uses the decorative
 *   quotation-mark style; when false (compact previews) every level uses the
 *   lighter vertical-bar style.
 */
function renderQuoteTree(
  entries: QuoteEntry[],
  currentDepth: number,
  baseIdx: number,
  renderLine: (content: string, idx: number, offset: number) => React.ReactNode,
  decorateOutermost: boolean
): React.ReactNode {
  const children: React.ReactNode[] = []
  let i = 0

  while (i < entries.length) {
    const entry = entries[i]
    if (entry.depth <= currentDepth) {
      // Render this line at the current depth.
      // Add <br/> between consecutive same-depth lines.
      if (children.length > 0 && i > 0 && entries[i - 1].depth <= currentDepth) {
        children.push(<br key={`br-${baseIdx + i}`} />)
      }
      children.push(
        <React.Fragment key={`line-${baseIdx + i}`}>
          {renderLine(entry.content, baseIdx + i, entry.offset)}
        </React.Fragment>
      )
      i++
    } else {
      // Collect consecutive deeper lines and render as a nested blockquote.
      const nestedStart = i
      while (i < entries.length && entries[i].depth > currentDepth) {
        i++
      }
      children.push(renderQuoteTree(entries.slice(nestedStart, i), currentDepth + 1, baseIdx + nestedStart, renderLine, decorateOutermost))
    }
  }

  const isDecorated = decorateOutermost && currentDepth === 1
  return (
    <blockquote
      key={`quote-${baseIdx}`}
      className={isDecorated ? 'blockquote-decorated text-fluux-muted' : 'blockquote-nested text-fluux-muted'}
    >
      {children}
    </blockquote>
  )
}

/**
 * Render a compact preview of a (possibly quoted) message body for the reply
 * chip. Quote markers ("> ", ">>", "> >") become nested vertical bars at any
 * depth; everything else is rendered as plain text. Links and inline styling
 * are intentionally not rendered here — the chip is a button, so nested
 * interactive/markup elements are avoided.
 */
export function renderQuotePreview(text: string): React.ReactNode {
  if (!text) return null
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const result: React.ReactNode[] = []
  let quoteBuffer: QuoteEntry[] = []
  let key = 0

  const flush = () => {
    if (quoteBuffer.length > 0) {
      result.push(renderQuoteTree(quoteBuffer, 1, key, (content) => content, false))
      key += quoteBuffer.length + 1
      quoteBuffer = []
    }
  }

  for (const line of lines) {
    const quote = isBlockquote(line)
    if (quote.isQuote) {
      quoteBuffer.push({ depth: quote.depth, content: quote.content, offset: 0 })
    } else {
      flush()
      if (result.length > 0) result.push(<br key={`pbr-${key}`} />)
      result.push(<React.Fragment key={`pt-${key++}`}>{line}</React.Fragment>)
    }
  }
  flush()

  return result
}

/** Two spaces per nesting level, the CommonMark-ish convention; tabs count as one level. */
const INDENT_WIDTH = 2
/** Deeper than this and the indentation is almost certainly not a list. */
const MAX_LIST_DEPTH = 5

/** Leading-whitespace width of a line, in nesting levels. */
function indentDepth(line: string): number {
  const leading = line.match(/^[ \t]*/)?.[0] ?? ''
  const spaces = leading.replace(/\t/g, ' '.repeat(INDENT_WIDTH)).length
  return Math.min(Math.floor(spaces / INDENT_WIDTH), MAX_LIST_DEPTH)
}

/**
 * Check if a line is an unordered list item (starts with -, +, or * followed by space)
 * Note: * must be followed by space to distinguish from *bold* formatting
 * Leading whitespace sets the nesting depth.
 */
function isUnorderedListItem(line: string): { isList: boolean; content: string; marker: string; depth: number } {
  const match = line.match(/^[ \t]*([-+*])\s+(.*)$/)
  if (match) {
    return { isList: true, marker: match[1], content: match[2], depth: indentDepth(line) }
  }
  return { isList: false, marker: '', content: line, depth: 0 }
}

/**
 * Check if a line is an ordered list item (starts with number. followed by space)
 * Leading whitespace sets the nesting depth.
 */
function isOrderedListItem(line: string): { isList: boolean; number: number; content: string; depth: number } {
  const match = line.match(/^[ \t]*(\d+)\.\s+(.*)$/)
  if (match) {
    return { isList: true, number: parseInt(match[1], 10), content: match[2], depth: indentDepth(line) }
  }
  return { isList: false, number: 0, content: line, depth: 0 }
}

/** A buffered list item, flattened; `depth` drives the nesting when it's flushed. */
interface ListItem {
  depth: number
  content: string
  offset: number
  /** Ordered lists only: the literal number the sender typed. */
  number?: number
}

/**
 * A GFM task-list item: "- [ ] todo" / "- [x] done". Applies to the *content* of
 * an already-recognised list item, so the leading marker is gone by now.
 * Deliberately read-only — a checkbox in a received message reflects what the
 * sender typed; toggling it would have to edit and resend their message.
 */
function parseTaskItem(content: string): { isTask: boolean; checked: boolean; content: string } {
  const match = content.match(/^\[([ xX])\]\s+(.*)$/)
  if (match) {
    return { isTask: true, checked: match[1].toLowerCase() === 'x', content: match[2] }
  }
  return { isTask: false, checked: false, content }
}

/** Column alignment from a table's delimiter row. */
type ColumnAlign = 'left' | 'center' | 'right'

/**
 * Split a table row on unescaped pipes, dropping the optional leading/trailing
 * ones. "| a | b |" and "a | b" both yield ["a", "b"].
 */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]
    if (char === '\\' && trimmed[i + 1] === '|') {
      cell += '|'
      i++
    } else if (char === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell.trim())
  return cells
}

/**
 * Is this the delimiter row under a table header? Every cell must be dashes,
 * optionally colon-anchored on either side: |---|:--|--:|:-:|
 */
function parseTableDelimiter(line: string): ColumnAlign[] | null {
  if (!line.includes('-') || !line.includes('|')) return null

  const cells = splitTableRow(line)
  if (cells.length === 0) return null

  const aligns: ColumnAlign[] = []
  for (const cell of cells) {
    const match = cell.match(/^(:?)-+(:?)$/)
    if (!match) return null
    const [, left, right] = match
    aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : 'left')
  }
  return aligns
}

/**
 * Does a table start at `lines[i]`? Requires a header row containing a pipe
 * immediately followed by a delimiter row, which keeps prose that merely
 * contains a "|" from being swallowed as a one-column table.
 */
function tableStartsAt(lines: string[], i: number): ColumnAlign[] | null {
  if (!lines[i]?.includes('|')) return null
  if (i + 1 >= lines.length) return null
  return parseTableDelimiter(lines[i + 1])
}

/**
 * Check if a line is a heading (starts with # followed by space)
 * Supports levels 1-4 (# through ####)
 */
function isHeading(line: string): { isHeading: boolean; level: number; content: string } {
  const match = line.match(/^(#{1,4})\s+(.+)$/)
  if (match) {
    return { isHeading: true, level: match[1].length, content: match[2] }
  }
  return { isHeading: false, level: 0, content: line }
}

/**
 * Render text with clickable links only (no other styling)
 * Useful for room subjects and other simple text that may contain URLs
 */
export function renderTextWithLinks(text: string): React.ReactNode {
  if (!text) return null

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match

  // Reset regex state
  URL_REGEX.lastIndex = 0

  while ((match = URL_REGEX.exec(text)) !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    // Add the URL as a clickable link
    const url = match[0]
    parts.push(<MessageLink key={match.index} href={url} />)

    lastIndex = match.index + url.length
  }

  // Add remaining text after last URL
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  // If no links found, just return the text
  if (parts.length === 0) {
    return text
  }

  return parts
}

/**
 * Parse and render a complete message with all styling
 * @param text - The message body
 * @param mentions - Optional XEP-0372 mention references for precise highlighting
 * @param nickname - Optional user nickname for IRC-style mention detection fallback
 * @param markdown - Render Markdown-only constructs (headings, lists, tables,
 *   labelled links). XEP-0393 styling is unaffected and always renders.
 */
// ---------------------------------------------------------------------------
// GFM rendering (markdown === true). A hand-rolled token walker over a
// markdown-it parser (CommonMark + GFM) that emits React nodes directly — no
// raw HTML, so mention pills, link safety and the code-block widget keep
// behaving exactly like the XEP-0393 branch instead of being bypassed by a
// library's escaped-string output.
// ---------------------------------------------------------------------------

interface GfmTok {
  type: string
  content?: string
  info?: string
  tag?: string
  nesting?: number
  attrs?: Array<[string, string]>
  children?: GfmTok[]
}

interface GfmCtx {
  isDarkMode?: boolean
  disableMentionFallback: boolean
  resolveMentionColor?: (identifier: string) => string | undefined
}

let gfmRendererSingleton: MarkdownIt | undefined

function getGfmRenderer(): MarkdownIt {
  if (gfmRendererSingleton) return gfmRendererSingleton
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false })
  // GFM link safety: markdown-it lets any scheme through by default; block
  // javascript:/data: and anything that is not a plain-text scheme so the
  // fork's no-script-scheme policy holds on the GFM branch too.
  md.validateLink = (url: string): boolean => {
    const scheme = url.trim().match(/^([a-z][a-z0-9+.-]*):/i)?.[1] ?? ''
    return scheme === '' || /^(https?|ftp|mailto)$/i.test(scheme)
  }
  gfmRendererSingleton = md
  return md
}

/** Collect a token run until the matching close of `openType`, nesting-aware. */
function collectGfm(tokens: GfmTok[], i: number, openType: string, closeType: string): { nodes: GfmTok[]; next: number } {
  const nodes: GfmTok[] = []
  let depth = 1
  let j = i + 1
  while (j < tokens.length) {
    const t = tokens[j]
    if (t.type === openType) depth++
    else if (t.type === closeType) {
      depth--
      if (depth === 0) break
    }
    nodes.push(t)
    j++
  }
  return { nodes, next: Math.min(j + 1, tokens.length) }
}

/** Split a run of plain text on @mentions, colouring each identified mention. */
function gfmTextNodes(raw: string, ctx: GfmCtx, keyBase: number): React.ReactNode[] {
  if (ctx.disableMentionFallback) return [raw]
  const parts = raw.split(MENTION_REGEX)
  const out: React.ReactNode[] = []
  parts.forEach((part, pIdx) => {
    if (MENTION_REGEX.test(part)) {
      MENTION_REGEX.lastIndex = 0
      const identifier = part.slice(1)
      const color = ctx.resolveMentionColor?.(identifier) ?? getConsistentTextColor(identifier, ctx.isDarkMode ?? true)
      out.push(
        <span
          key={`${keyBase}-m${pIdx}`}
          className="px-1 rounded font-medium"
          style={{ color, backgroundColor: `${color}15` }}
          data-mention={identifier}
        >
          {part}
        </span>
      )
    } else if (part) {
      out.push(part)
    }
  })
  return out
}

/** Render a markdown-it INLINE token stream into React nodes (nesting-aware). */
function gfmInlineTokens(tokens: GfmTok[], ctx: GfmCtx): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t.type === 'text') {
      out.push(...gfmTextNodes(t.content ?? '', ctx, i))
      i++
    } else if (t.type === 'softbreak') {
      out.push(' ')
      i++
    } else if (t.type === 'hardbreak') {
      out.push(<br key={i} />)
      i++
    } else if (t.type === 'code_inline') {
      out.push(<code key={i} className="bg-fluux-bg/50 text-fluux-brand px-1.5 py-0.5 rounded text-sm font-mono">{t.content}</code>)
      i++
    } else if (t.type === 'html_inline') {
      out.push(t.content ?? '')
      i++
    } else if (t.type === 'image') {
      const src = t.attrs?.find((a) => a[0] === 'src')?.[1] ?? ''
      const alt = t.attrs?.find((a) => a[0] === 'alt')?.[1] ?? ''
      out.push(<span key={i} className="text-fluux-muted">{alt || 'image'}{src ? ` (${src})` : ''}</span>)
      i++
    } else if (t.type === 'link_open') {
      const inner = collectGfm(tokens, i, 'link_open', 'link_close')
      const href = t.attrs?.find((a) => a[0] === 'href')?.[1] ?? ''
      const safe = getGfmRenderer().validateLink(href)
      const children = gfmInlineTokens(inner.nodes, ctx)
      out.push(safe ? <MessageLink key={i} href={href}>{children}</MessageLink> : children)
      i = inner.next
    } else if (t.type === 'strong_open') {
      const inner = collectGfm(tokens, i, 'strong_open', 'strong_close')
      out.push(<strong key={i} className="font-semibold">{gfmInlineTokens(inner.nodes, ctx)}</strong>)
      i = inner.next
    } else if (t.type === 'em_open') {
      const inner = collectGfm(tokens, i, 'em_open', 'em_close')
      out.push(<em key={i}>{gfmInlineTokens(inner.nodes, ctx)}</em>)
      i = inner.next
    } else if (t.type === 's_open') {
      const inner = collectGfm(tokens, i, 's_open', 's_close')
      out.push(<del key={i} className="line-through opacity-70">{gfmInlineTokens(inner.nodes, ctx)}</del>)
      i = inner.next
    } else {
      if (t.content) out.push(t.content)
      i++
    }
  }
  return out
}

/** Parse a block-inline leaf token's ALREADY-decomposed children to React. */
function gfmInlineLeaf(leaf: GfmTok, ctx: GfmCtx): React.ReactNode[] {
  const children = (leaf.children as GfmTok[] | undefined) ?? []
  return gfmInlineTokens(children, ctx)
}

function gfmHeading(level: number, children: React.ReactNode[], key: number): React.ReactNode {
  const cls =
    level === 1 ? 'text-lg font-bold mt-1' : level === 2 ? 'text-base font-semibold mt-1' : 'text-sm font-semibold mt-1'
  return React.createElement(`h${Math.max(1, Math.min(6, level))}`, { key, className: cls }, children)
}

/** Extracts a `- [ ]` / `- [x]` task marker from a list item's raw text. */
interface TaskMarker {
  checked: boolean
  body: string
}
function gfmTaskMarker(raw: string): TaskMarker | null {
  const m = raw.trimStart().match(/^\[([ xX])\]\s?(.*)$/s)
  return m ? { checked: m[1] !== ' ', body: m[2] } : null
}

/** Render a list item's inner tokens, unwrapping a leading single paragraph so
 *  the text becomes a direct child of the <li>. The bullet/number marker box
 *  then shares the text's line box; a nested <p> block (as markdown-it emits)
 *  shifts the text off-line from the marker. */
function gfmItemBody(tokens: GfmTok[], ctx: GfmCtx): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let i = 0
  if (tokens.length >= 3 && tokens[0].type === 'paragraph_open') {
    out.push(...gfmInlineLeaf(tokens[1], ctx))
    let close = 2
    while (close < tokens.length && tokens[close].type !== 'paragraph_close') close++
    i = Math.min(close + 1, tokens.length)
  }
  if (i < tokens.length) out.push(...gfmRenderBlocks(tokens.slice(i), ctx))
  return out
}

/** Render list_item_open..close runs to <li>, handling task checkboxes + nesting. */
function gfmListItems(tokens: GfmTok[], ctx: GfmCtx): React.ReactNode[] {
  const items: React.ReactNode[] = []
  let i = 0
  while (i < tokens.length) {
    if (tokens[i].type !== 'list_item_open') {
      i++
      continue
    }
    const inner = collectGfm(tokens, i, 'list_item_open', 'list_item_close')
    // Find the first paragraph text in this item for the task checkmark.
    const firstP = inner.nodes.find((n) => n.type === 'paragraph_open')
    const pIdx = inner.nodes.indexOf(firstP ?? { type: '' })
    const leaf = firstP && pIdx >= 0 ? inner.nodes[pIdx + 1] : undefined
    const task = leaf ? gfmTaskMarker(leaf.content ?? '') : null

    let children: React.ReactNode
    if (task) {
      const restTokens = [...inner.nodes]
      if (firstP && pIdx >= 0) {
        // The renderer reads an inline token's .children (not .content), so strip
        // the `[x]`/`[ ]` marker from the leading text child — otherwise the
        // checkbox renders AND the literal marker leaks into the text.
        const lf = inner.nodes[pIdx + 1] as GfmTok
        const kids = (lf.children as GfmTok[] | undefined) ?? []
        restTokens[pIdx + 1] =
          kids[0]
            ? { ...lf, content: task.body, children: [{ ...kids[0], content: task.body }] }
            : { ...lf, content: task.body }
      }
      const content = pIdx >= 0 ? gfmItemBody(restTokens, ctx) : gfmItemBody(inner.nodes, ctx)
      children = (
        <span className="li-flex">
          <input type="checkbox" checked={task.checked} readOnly tabIndex={-1} aria-label={task.checked ? 'done' : 'todo'} />
          {content}
        </span>
      )
    } else {
      children = gfmItemBody(inner.nodes, ctx)
    }
    items.push(<li key={i} className={task ? 'list-none' : undefined}>{children}</li>)
    i = inner.next
  }
  return items
}

/** Wrap the cells from a `table` vs `table_open`-child token stream into thead/tbody rows. */
function gfmRenderTable(block: GfmTok[], ctx: GfmCtx, key: number): React.ReactNode {
  const headRows: React.ReactNode[] = []
  const bodyRows: React.ReactNode[] = []
  let inHead = false
  let i = 0
  while (i < block.length) {
    const t = block[i]
    if (t.type === 'thead_open') {
      inHead = true
      i++
    } else if (t.type === 'tbody_open') {
      inHead = false
      i++
    } else if (t.type === 'tr_open') {
      let j = i + 1
      const cells: React.ReactNode[] = []
      while (j < block.length && block[j].type !== 'tr_close') {
        const ct = block[j]
        if (ct.type === 'th_open' || ct.type === 'td_open') {
          const align = ct.attrs?.find((a) => a[0] === 'align')?.[1]
          const wrap = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
          const grid = `${wrap} border border-fluux-border px-2 py-1${ct.type === 'th_open' ? ' font-semibold' : ''}`.trim()
          const el = ct.type === 'th_open' ? 'th' : 'td'
          const cellInlineTok = block[j + 1]
          cells.push(React.createElement(el, { key: j, className: grid }, cellInlineTok ? gfmInlineLeaf(cellInlineTok, ctx) : []))
          j += 3
        } else j++
      }
      cells.push(null)
      const row = React.createElement('tr', { key: i, className: undefined }, cells.filter((c) => c !== null))
      ;(inHead ? headRows : bodyRows).push(row)
      i = j + 1
    } else i++
  }
  const thead = headRows.length > 0 ? <thead>{headRows}</thead> : null
  return (
    <div className="my-1 overflow-x-auto" key={key}>
      <table className="border-collapse text-sm">
        {thead}
        {bodyRows.length > 0 ? <tbody>{bodyRows}</tbody> : null}
      </table>
    </div>
  )
}

/** Render a parsed markdown block token stream into React nodes. */
function gfmRenderBlocks(tokens: GfmTok[], ctx: GfmCtx, keyBase = 0): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    const key = keyBase + i
    switch (t.type) {
      case 'paragraph_open': {
        const leaf = tokens[i + 1]
        out.push(
          <p key={key} className="my-1">
            {gfmInlineLeaf(leaf, ctx)}
          </p>,
        )
        i += 3
        break
      }
      case 'heading_open': {
        // markdown-it sets the level on the token's tag (h1..h6), not an attr.
        const levelMatch = (t.tag ?? '').match(/^h([1-6])$/)
        const level = levelMatch ? Number(levelMatch[1]) : 1
        const leaf = tokens[i + 1]
        out.push(gfmHeading(level, gfmInlineLeaf(leaf, ctx), key))
        i += 3
        break
      }
      case 'blockquote_open': {
        const inner = collectGfm(tokens, i, 'blockquote_open', 'blockquote_close')
        out.push(
          // Carry over the legacy blockquote treatment: muted text + left rail.
          <blockquote className="border-l-2 border-fluux-border pl-2 text-fluux-muted" key={key}>
            {gfmRenderBlocks(inner.nodes, ctx, key + 1000)}
          </blockquote>
        )
        i = inner.next
        break
      }
      case 'bullet_list_open': {
        const inner = collectGfm(tokens, i, 'bullet_list_open', 'bullet_list_close')
        out.push(
          <ul key={key} className="list-disc list-inside my-1 space-y-0.5 [&_ul]:ml-4 [&_ul]:my-0">
            {gfmListItems(inner.nodes, ctx)}
          </ul>,
        )
        i = inner.next
        break
      }
      case 'ordered_list_open': {
        const inner = collectGfm(tokens, i, 'ordered_list_open', 'ordered_list_close')
        const start = t.attrs?.find((a) => a[0] === 'start')?.[1]
        out.push(
          <ol
            key={key}
            start={start ? Number(start) : undefined}
            className="list-decimal list-inside my-1 space-y-0.5 [&_ol]:ml-4 [&_ol]:my-0"
          >
            {gfmListItems(inner.nodes, ctx)}
          </ol>,
        )
        i = inner.next
        break
      }
      case 'fence': {
        out.push(<CodeBlock key={key} code={t.content ?? ''} language={t.info?.trim() || undefined} keyProp={`gf${key}`} />)
        i++
        break
      }
      case 'code_block': {
        out.push(<CodeBlock key={key} code={t.content ?? ''} language={undefined} keyProp={`gfb${key}`} />)
        i++
        break
      }
      case 'table_open': {
        const inner = collectGfm(tokens, i, 'table_open', 'table_close')
        out.push(gfmRenderTable(inner.nodes, ctx, key))
        i = inner.next
        break
      }
      case 'hr': {
        out.push(<hr key={key} className="border-fluux-border" />)
        i++
        break
      }
      default:
        i++
    }
  }
  return out
}

/** Parse one markdown body and render it as GFM React nodes. */
function renderGfm(normalizedText: string, ctx: GfmCtx): React.ReactNode {
  const md = getGfmRenderer()
  const tokens = md.parse(normalizedText, md, {}) as GfmTok[]
  const nodes = gfmRenderBlocks(tokens, ctx)
  return nodes.length === 0 ? '' : nodes.length === 1 ? nodes[0] : nodes
}

export function renderStyledMessage(text: string, mentions?: MentionReference[], nickname?: string, knownNicks?: ReadonlySet<string>, isDarkMode?: boolean, resolveMentionColor?: (identifier: string) => string | undefined, markdown: boolean = false): React.ReactNode {
  // Normalize line endings: CRLF -> LF, CR -> LF
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // If we have XEP-0372 mentions, use them for precise highlighting.
  // Otherwise, try IRC-style mention detection if a nickname is provided.
  // Final fallback: the regex in parseInlineStyles detects @mention patterns.
  let mentionRanges: MentionRange[] | null = null
  if (mentions && mentions.length > 0) {
    mentionRanges = mentions.map(m => ({ begin: m.begin, end: m.end, uri: m.uri })).sort((a, b) => a.begin - b.begin)
  } else if (nickname) {
    const detected = findMentionRanges(normalizedText, nickname)
    mentionRanges = detected.length > 0 ? detected : null
  }

  // When no XEP-0372 mentions, also detect IRC-style prefix mention for known occupants
  // (e.g., "Holger:" or "raver," at message start) for visual highlighting
  if ((!mentions || mentions.length === 0) && knownNicks && knownNicks.size > 0) {
    const ircRange = findIrcPrefixRange(normalizedText, knownNicks)
    if (ircRange) {
      if (!mentionRanges) {
        mentionRanges = [ircRange]
      } else {
        const overlaps = mentionRanges.some(r => r.begin < ircRange.end && r.end > ircRange.begin)
        if (!overlaps) {
          mentionRanges = [...mentionRanges, ircRange].sort((a, b) => a.begin - b.begin)
        }
      }
    }
  }

  // In 1:1 chats (no mentions, no nickname, no knownNicks), disable the regex
  // fallback that colorizes any @word — only colorize actual user mentions
  const disableMentionFallback = (!mentions || mentions.length === 0) && !nickname && (!knownNicks || knownNicks.size === 0)

  // GFM mode (markdown on): render the whole body through markdown-it
  // (CommonMark + GFM) instead of the hand-rolled XEP-0393 layering. Mention
  // colouring + link safety apply inside the token walk so the library's string
  // output never bypasses the fork's controls. The off branch below is the
  // unchanged XEP-0393 renderer.
  if (markdown) {
    return renderGfm(normalizedText, { isDarkMode, disableMentionFallback, resolveMentionColor })
  }

  // Check for code blocks first (```lang newline ... newline ```)
  // Fences must sit at the start of a line (<=3 spaces indent) and the opener
  // must be its own line. Without the line anchor, any stray ``` token in
  // prose pairs with the next ``` anywhere in the message and swallows a swath
  // of text as one bogus "code block" — so inline backticks (e.g. in a
  // collapsed /dump pretty row) are treated as literal text, per CommonMark.
  const codeBlockRegex = /(?<=\n|^)[ \t]{0,3}```(\w*)[^\n]*\r?\n([\s\S]*?)\r?\n[ \t]{0,3}```[ \t]*(?=\r?\n|$)/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match
  let partIndex = 0

  while ((match = codeBlockRegex.exec(normalizedText)) !== null) {
    // Render text before code block
    if (match.index > lastIndex) {
      const before = normalizedText.slice(lastIndex, match.index)
      parts.push(...renderTextBlock(before, partIndex, mentionRanges, lastIndex, isDarkMode, disableMentionFallback, resolveMentionColor, markdown))
      partIndex += 100 // Leave room for sub-indices
    }

    // Render code block with copy button and optional syntax highlighting
    const lang = match[1] || undefined
    const codeContent = match[2].trim()
    parts.push(
      <CodeBlock key={`code-${partIndex++}`} code={codeContent} language={lang} keyProp={`code-${partIndex}`} />
    )

    lastIndex = match.index + match[0].length
  }

  // Render remaining text
  if (lastIndex < normalizedText.length) {
    parts.push(...renderTextBlock(normalizedText.slice(lastIndex), partIndex, mentionRanges, lastIndex, isDarkMode, disableMentionFallback, resolveMentionColor, markdown))
  }

  // If no code blocks, render the whole thing
  if (parts.length === 0) {
    return renderTextBlock(normalizedText, 0, mentionRanges, 0, isDarkMode, disableMentionFallback, resolveMentionColor, markdown)
  }

  return parts
}

/**
 * Render a buffered run of list items as nested <ul>/<ol>.
 *
 * Items arrive flat with a `depth` each; a run of deeper items immediately
 * following an item becomes that item's sublist. Nesting is within a single list
 * type — an indented "-" under a "1." continues the ordered list rather than
 * switching to a bullet, which keeps the buffering in renderTextBlock simple and
 * matches how most senders actually write.
 */
function renderList(
  items: ListItem[],
  ordered: boolean,
  keyPrefix: string,
  renderItem: (content: string, offset: number, key: number) => React.ReactNode
): React.ReactElement {
  const baseDepth = Math.min(...items.map((item) => item.depth))
  const children: React.ReactNode[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    // Collect the deeper run that follows this item — its sublist.
    let end = i + 1
    while (end < items.length && items[end].depth > item.depth) end++
    const nested = items.slice(i + 1, end)

    const task = parseTaskItem(item.content)
    // A task item replaces the bullet/number with its checkbox, so drop the
    // marker for that row only — a list mixing tasks and prose keeps both.
    children.push(
      <li key={`${keyPrefix}-li-${i}`} className={task.isTask ? 'text-fluux-text list-none' : 'text-fluux-text'}>
        {task.isTask && (
          <input
            type="checkbox"
            checked={task.checked}
            readOnly
            aria-label={task.content}
            className="me-1.5 align-middle accent-fluux-brand pointer-events-none"
          />
        )}
        {renderItem(task.content, item.offset + (item.content.length - task.content.length), i)}
        {nested.length > 0 && renderList(nested, ordered, `${keyPrefix}-${i}`, renderItem)}
      </li>
    )

    i = end - 1
  }

  const className = ordered
    ? 'list-decimal list-inside my-1 space-y-0.5 [&_ol]:ml-4 [&_ol]:my-0'
    : 'list-disc list-inside my-1 space-y-0.5 [&_ul]:ml-4 [&_ul]:my-0'

  if (ordered) {
    const startNum = items.find((item) => item.depth === baseDepth)?.number ?? 1
    return <ol key={keyPrefix} start={startNum} className={className}>{children}</ol>
  }
  return <ul key={keyPrefix} className={className}>{children}</ul>
}

/** Render a GFM-style pipe table. */
function renderTable(
  header: string[],
  aligns: ColumnAlign[],
  rows: string[][],
  keyPrefix: string,
  renderCell: (content: string, key: number) => React.ReactNode
): React.ReactElement {
  const alignClass = (col: number) =>
    aligns[col] === 'center' ? 'text-center' : aligns[col] === 'right' ? 'text-right' : 'text-left'

  return (
    // Tables are the one construct that can genuinely exceed the bubble width, so
    // it scrolls inside its own box rather than widening the message column.
    <div key={keyPrefix} className="my-1 overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th
                key={i}
                className={`border border-fluux-border px-2 py-1 font-semibold ${alignClass(i)}`}
              >
                {renderCell(cell, i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {header.map((_, c) => (
                <td key={c} className={`border border-fluux-border px-2 py-1 ${alignClass(c)}`}>
                  {renderCell(row[c] ?? '', (r + 1) * 100 + c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Render a text block (handles blockquotes, lists, tables, and inline styles)
 */
function renderTextBlock(
  text: string,
  startIndex: number,
  mentionRanges: MentionRange[] | null = null,
  textOffset: number = 0,
  isDarkMode?: boolean,
  disableMentionFallback: boolean = false,
  resolveMentionColor?: (identifier: string) => string | undefined,
  markdown: boolean = true
): React.ReactNode[] {
  const lines = text.split('\n')
  const result: React.ReactNode[] = []
  let quoteBuffer: { depth: number; content: string; offset: number }[] | null = null
  let ulBuffer: ListItem[] | null = null
  let olBuffer: ListItem[] | null = null
  let index = startIndex
  let currentOffset = textOffset

  const flushQuote = () => {
    if (quoteBuffer && quoteBuffer.length > 0) {
      result.push(
        renderQuoteTree(
          quoteBuffer,
          1,
          index,
          (content, idx, offset) => renderInline(content, idx, mentionRanges, offset, isDarkMode, disableMentionFallback, resolveMentionColor, markdown),
          true
        )
      )
      index += quoteBuffer.length
      quoteBuffer = null
    }
  }

  const renderListItem = (content: string, offset: number, key: number) =>
    renderInline(content, index + key, mentionRanges, offset, isDarkMode, disableMentionFallback, resolveMentionColor, markdown)

  const flushUnorderedList = () => {
    if (ulBuffer && ulBuffer.length > 0) {
      result.push(renderList(ulBuffer, false, `ul-${index++}`, renderListItem))
      index += ulBuffer.length
      ulBuffer = null
    }
  }

  const flushOrderedList = () => {
    if (olBuffer && olBuffer.length > 0) {
      result.push(renderList(olBuffer, true, `ol-${index++}`, renderListItem))
      index += olBuffer.length
      olBuffer = null
    }
  }

  const flushAllBuffers = () => {
    flushQuote()
    flushUnorderedList()
    flushOrderedList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineOffset = currentOffset

    // Check for blockquote first
    const quoteCheck = isBlockquote(line)
    if (quoteCheck.isQuote) {
      // Flush other buffers before starting/continuing quote
      flushUnorderedList()
      flushOrderedList()

      if (!quoteBuffer) {
        quoteBuffer = []
      }
      const prefixLength = line.length - quoteCheck.content.length
      quoteBuffer.push({ depth: quoteCheck.depth, content: quoteCheck.content, offset: lineOffset + prefixLength })
      currentOffset += line.length + 1
      continue
    }

    // Check for a table: header row + delimiter row, then rows until a
    // non-table line. Tables are Markdown-only (XEP-0393 has no table syntax).
    if (markdown) {
      const aligns = tableStartsAt(lines, i)
      if (aligns) {
        flushAllBuffers()

        const header = splitTableRow(line)
        const rows: string[][] = []
        currentOffset += line.length + 1 + lines[i + 1].length + 1

        let r = i + 2
        while (r < lines.length && lines[r].includes('|') && lines[r].trim() !== '') {
          rows.push(splitTableRow(lines[r]))
          currentOffset += lines[r].length + 1
          r++
        }

        result.push(
          renderTable(header, aligns, rows, `table-${index++}`, (content, key) =>
            renderInline(content, index + key, null, 0, isDarkMode, true, resolveMentionColor, markdown)
          )
        )

        i = r - 1
        continue
      }
    }

    // Check for unordered list item
    const ulCheck = isUnorderedListItem(line)
    if (markdown && ulCheck.isList) {
      // Flush other buffers before starting/continuing unordered list
      flushQuote()
      flushOrderedList()

      if (!ulBuffer) {
        ulBuffer = []
      }
      const prefixLength = line.length - ulCheck.content.length
      ulBuffer.push({ depth: ulCheck.depth, content: ulCheck.content, offset: lineOffset + prefixLength })
      currentOffset += line.length + 1
      continue
    }

    // Check for ordered list item
    const olCheck = isOrderedListItem(line)
    if (markdown && olCheck.isList) {
      // Flush other buffers before starting/continuing ordered list
      flushQuote()
      flushUnorderedList()

      if (!olBuffer) {
        olBuffer = []
      }
      const prefixLength = line.length - olCheck.content.length
      olBuffer.push({
        depth: olCheck.depth,
        number: olCheck.number,
        content: olCheck.content,
        offset: lineOffset + prefixLength
      })
      currentOffset += line.length + 1
      continue
    }

    // Check for heading (# Title, ## Subtitle, etc.)
    const headingCheck = isHeading(line)
    if (markdown && headingCheck.isHeading) {
      flushAllBuffers()

      const level = headingCheck.level
      const prefixLength = line.length - headingCheck.content.length
      const headingClasses =
        level === 1 ? 'text-lg font-bold' :
        level === 2 ? 'text-base font-semibold' :
        'text-sm font-semibold'

      result.push(
        <div key={`heading-${index++}`} className={`${headingClasses} mt-1`}>
          {renderInline(headingCheck.content, index, mentionRanges, lineOffset + prefixLength, isDarkMode, disableMentionFallback, resolveMentionColor)}
        </div>
      )

      currentOffset += line.length + 1
      continue
    }

    // Regular line - flush all buffers first
    flushAllBuffers()

    if (line || i < lines.length - 1) {
      result.push(
        <React.Fragment key={`line-${index++}`}>
          {renderInline(line, index, mentionRanges, lineOffset, isDarkMode, disableMentionFallback, resolveMentionColor, markdown)}
          {i < lines.length - 1 && <br />}
        </React.Fragment>
      )
    }

    currentOffset += line.length + 1
  }

  // Flush any remaining buffers
  flushAllBuffers()
  return result
}

/**
 * Render inline styled text
 */
function renderInline(
  text: string,
  keyBase: number,
  mentionRanges: MentionRange[] | null = null,
  textOffset: number = 0,
  isDarkMode?: boolean,
  disableMentionFallback: boolean = false,
  resolveMentionColor?: (identifier: string) => string | undefined,
  markdown: boolean = true
): React.ReactNode {
  if (!text) return null
  const segments = parseInlineStyles(text, mentionRanges, textOffset, disableMentionFallback, markdown)
  if (segments.length === 1 && segments[0].type === 'text') {
    return segments[0].content
  }
  return segments.map((seg, i) => renderSegment(seg, keyBase * 1000 + i, isDarkMode, resolveMentionColor))
}
