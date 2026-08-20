/**
 * Minimal ambient types for markdown-it (v14). The package ships no
 * declarations; rather than add @types/markdown-it as a runtime-installed
 * dev dep on every checkout, we declare just the surface messageStyles.tsx
 * uses (constructor options, parse/parseInline, validateLink and the token
 * shape). Covers everything the GFM branch touches.
 */
declare module 'markdown-it' {
  interface MarkdownItOptions {
    html?: boolean
    linkify?: boolean
    typographer?: boolean
    breaks?: boolean
  }

  interface Token {
    type: string
    content?: string
    info?: string
    tag?: string
    nesting?: number
    attrs?: Array<[string, string]>
    children?: Token[] | null
  }

  class MarkdownIt {
    constructor(options?: MarkdownItOptions)
    options: MarkdownItOptions
    validateLink: (raw: string) => boolean
    parse(src: string, md: MarkdownIt, env: unknown): Token[]
    parseInline(src: string, md: MarkdownIt, env: unknown): Token[]
  }

  export default MarkdownIt
}