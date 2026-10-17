import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isInternalHref } from "../cards/CardParts";

// 도우미 답변 Markdown. 원시 HTML은 그리지 않는다(react-markdown 기본값).
const components: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  h1: ({ children }) => <p className="font-semibold">{children}</p>,
  h2: ({ children }) => <p className="font-semibold">{children}</p>,
  h3: ({ children }) => <p className="font-semibold">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] break-words">{children}</code>,
  pre: ({ children }) => <pre className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-xs">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
  table: ({ children }) => (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b px-2 py-1 text-left font-medium whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="border-b px-2 py-1">{children}</td>,
  a: ({ href, children }) =>
    isInternalHref(href) ? (
      <Link href={href} className="text-primary underline underline-offset-2">
        {children}
      </Link>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
        {children}
      </a>
    ),
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
