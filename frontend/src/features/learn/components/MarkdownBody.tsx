import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// 본문은 Markdown만 그린다. 원시 HTML은 렌더링하지 않고 버린다(skipHtml, 스펙 07 5절).
// 링크·이미지 주소는 react-markdown 기본 urlTransform이 javascript: 같은 위험한 주소를 지운다.
/** react-markdown이 넘기는 `node`(구문 트리)는 DOM 속성으로 내려보내지 않는다. */
function withoutNode<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const rest = { ...props };
  delete rest.node;
  return rest;
}

const components: Components = {
  h1: (props) => <h2 className="mt-8 text-xl font-semibold first:mt-0" {...withoutNode(props)} />,
  h2: (props) => <h2 className="mt-8 text-lg font-semibold first:mt-0" {...withoutNode(props)} />,
  h3: (props) => <h3 className="mt-6 text-base font-semibold first:mt-0" {...withoutNode(props)} />,
  h4: (props) => <h4 className="mt-4 font-semibold first:mt-0" {...withoutNode(props)} />,
  p: (props) => <p className="mt-3 leading-7 first:mt-0" {...withoutNode(props)} />,
  ul: (props) => <ul className="mt-3 list-disc space-y-1 pl-5" {...withoutNode(props)} />,
  ol: (props) => <ol className="mt-3 list-decimal space-y-1 pl-5" {...withoutNode(props)} />,
  li: (props) => <li className="leading-7" {...withoutNode(props)} />,
  blockquote: (props) => (
    <blockquote className="mt-3 border-l-4 pl-4 text-muted-foreground" {...withoutNode(props)} />
  ),
  a: ({ href, ...props }) => (
    <a
      href={href}
      className="font-medium text-primary underline underline-offset-4"
      {...(href?.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...withoutNode(props)}
    />
  ),
  code: ({ className, ...props }) => (
    <code className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]", className)} {...withoutNode(props)} />
  ),
  pre: (props) => (
    <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-sm [&_code]:bg-transparent [&_code]:p-0" {...withoutNode(props)} />
  ),
  table: (props) => (
    <div className="mt-3 max-w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...withoutNode(props)} />
    </div>
  ),
  th: (props) => <th className="border-b px-2 py-1.5 text-left font-medium" {...withoutNode(props)} />,
  td: (props) => <td className="border-b px-2 py-1.5" {...withoutNode(props)} />,
  hr: (props) => <hr className="my-6" {...withoutNode(props)} />,
  img: ({ alt, ...props }) => (
    // eslint-disable-next-line @next/next/no-img-element -- 관리자가 쓴 Markdown 이미지는 크기를 알 수 없어 img를 그대로 쓴다.
    <img alt={alt ?? ""} className="mt-3 h-auto max-w-full rounded-lg" loading="lazy" {...withoutNode(props)} />
  ),
};

export function MarkdownBody({ children, className }: { children: string; className?: string }) {
  return (
    <div data-testid="markdown-body" className={cn("min-w-0 text-[15px] break-words break-keep", className)}>
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {children}
      </Markdown>
    </div>
  );
}
