import React, { useState } from "react"
import { marked, type Token, type Tokens } from "marked"
import { Check, Copy, ExternalLink, Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"

interface MarkdownContentProps {
  content: string
  onCitationClick?: (evidenceId: number) => void
  className?: string
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-2.5 rounded-lg border border-border/70 bg-zinc-950 dark:bg-zinc-900/90 text-zinc-100 overflow-hidden text-xs shadow-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800 text-[11px] font-mono text-zinc-400">
        <span className="flex items-center gap-1.5">
          <Terminal className="size-3 text-primary" />
          {lang || "code"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCopy}
          className="size-6 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          title="Copy code"
        >
          {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
        </Button>
      </div>
      <pre className="p-3 overflow-x-auto font-mono text-[11px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function MarkdownContent({
  content,
  onCitationClick,
  className = "",
}: MarkdownContentProps) {
  // Parse citations [Evidence #12] inside plain text
  const renderInlineText = (text: string, keyPrefix: string): React.ReactNode => {
    // Clean up awkward spaces before punctuation that LLMs sometimes generate (e.g. " [Evidence #59] ,")
    const cleaned = text.replace(/\s+([,.:;?!])/g, "$1")
    const parts = cleaned.split(/(\[Evidence #\d+\])/g)

    return parts.map((part, idx) => {
      const citationMatch = part.match(/^\[Evidence #(\d+)\]$/)
      if (citationMatch) {
        const evId = parseInt(citationMatch[1], 10)
        return (
          <button
            key={`${keyPrefix}-cite-${idx}`}
            type="button"
            onClick={() => onCitationClick?.(evId)}
            className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-muted hover:bg-muted/80 text-foreground border border-border hover:border-foreground/30 transition-all cursor-pointer shadow-2xs select-none"
            title={`Jump to Evidence #${evId}`}
          >
            <ExternalLink className="size-2.5 text-muted-foreground" />
            <span>Evidence #{evId}</span>
          </button>
        )
      }
      return <React.Fragment key={`${keyPrefix}-txt-${idx}`}>{part}</React.Fragment>
    })
  }

  // Recursive renderer for marked tokens
  const renderTokens = (tokens: Token[], parentKey: string): React.ReactNode => {
    return tokens.map((token, index) => {
      const key = `${parentKey}-${index}`

      switch (token.type) {
        case "heading": {
          const depth = token.depth
          const inner = token.tokens ? renderTokens(token.tokens, key) : token.text
          if (depth <= 2) {
            return (
              <h3
                key={key}
                className="mb-1.5 mt-4 flex items-center gap-1.5 text-[13px] font-semibold leading-snug text-foreground first:mt-0"
              >
                {inner}
              </h3>
            )
          }
          return (
            <h4
              key={key}
              className="text-xs font-semibold text-foreground tracking-tight mt-3 mb-1.5 first:mt-0"
            >
              {inner}
            </h4>
          )
        }

        case "paragraph": {
          const inner = token.tokens ? renderTokens(token.tokens, key) : token.text
          return (
            <p key={key} className="leading-relaxed text-foreground/90 my-1.5 first:mt-0 last:mb-0">
              {inner}
            </p>
          )
        }

        case "strong": {
          const inner = token.tokens ? renderTokens(token.tokens, key) : token.text
          return (
            <strong key={key} className="font-semibold text-foreground">
              {inner}
            </strong>
          )
        }

        case "em": {
          const inner = token.tokens ? renderTokens(token.tokens, key) : token.text
          return (
            <em key={key} className="italic text-foreground/90">
              {inner}
            </em>
          )
        }

        case "codespan": {
          return (
            <code
              key={key}
              className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground border border-border/60"
            >
              {token.text}
            </code>
          )
        }

        case "code": {
          return <CodeBlock key={key} code={token.text} lang={token.lang} />
        }

        case "list": {
          const Tag = token.ordered ? "ol" : "ul"
          const listClass = token.ordered
            ? "list-decimal pl-4 my-1.5 space-y-1 text-foreground/90"
            : "list-disc pl-4 my-1.5 space-y-1 text-foreground/90"
          return (
            <Tag key={key} className={listClass}>
              {token.items.map((item: Tokens.ListItem, itemIdx: number) => (
                <li key={`${key}-item-${itemIdx}`} className="leading-relaxed">
                  {item.tokens ? renderTokens(item.tokens, `${key}-item-${itemIdx}`) : item.text}
                </li>
              ))}
            </Tag>
          )
        }

        case "blockquote": {
          const inner = token.tokens ? renderTokens(token.tokens, key) : token.text
          return (
            <blockquote
              key={key}
              className="border-l-2 border-primary/40 pl-3 my-2 text-muted-foreground italic text-xs"
            >
              {inner}
            </blockquote>
          )
        }

        case "space": {
          return null
        }

        case "text": {
          // If token has nested inline tokens (e.g. inside list item)
          if (token.tokens && token.tokens.length > 0) {
            return (
              <React.Fragment key={key}>
                {renderTokens(token.tokens, key)}
              </React.Fragment>
            )
          }
          return renderInlineText(token.text, key)
        }

        default: {
          return renderInlineText(token.raw, key)
        }
      }
    })
  }

  const tokens = marked.lexer(content)

  return (
    <div className={`text-[13px] space-y-1.5 ${className}`}>
      {renderTokens(tokens, "root")}
    </div>
  )
}
