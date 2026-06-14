"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders advisor messages (GitHub-flavoured markdown) with the project's theme
 * tokens — no hardcoded colours, works in light and dark. Safe by construction:
 * react-markdown does not use dangerouslySetInnerHTML and tolerates the partial
 * markdown produced mid-stream.
 */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 text-xl font-semibold tracking-tight first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-lg font-semibold tracking-tight first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-3 text-base font-semibold tracking-tight first:mt-0">{children}</h3>
  ),
  ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  code: ({ className, children }) => {
    const isBlock = (className ?? "").includes("language-");
    if (isBlock) {
      return (
        <code className="block whitespace-pre overflow-x-auto rounded-md bg-background p-3 font-mono text-sm">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-background px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    );
  },
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
  th: ({ children }) => <th className="px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-t border-border px-2 py-1">{children}</td>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[15px] leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
