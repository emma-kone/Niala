"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

/** Énoncés et explications avec formules et tableaux. Chargé à la demande : KaTeX reste hors du paquet commun. */
export default function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: (p) => <p className="mb-2 last:mb-0" {...p} />,
          ul: (p) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0" {...p} />,
          ol: (p) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0" {...p} />,
          table: (p) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-sm" {...p} /></div>,
          th: (p) => <th className="border bg-muted/60 px-2 py-1 text-left font-medium" {...p} />,
          td: (p) => <td className="border px-2 py-1" {...p} />,
          pre: (p) => <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 font-code text-xs" {...p} />,
          code: (p) => <code className="font-code text-[0.9em]" {...p} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
