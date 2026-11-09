"use client";

import { memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import { Check, Copy } from "lucide-react";

const LANGUAGES = { bash, c, cpp, css, java, javascript, json, markup, php, python, sql, typescript };
for (const [name, grammar] of Object.entries(LANGUAGES)) SyntaxHighlighter.registerLanguage(name, grammar);

const ALIASES: Record<string, keyof typeof LANGUAGES> = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", html: "markup", xml: "markup", sh: "bash", shell: "bash", "c++": "cpp" };

function CopyCode({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />} {done ? "Copié" : "Copier"}
    </button>
  );
}

/** Couleurs de la coloration syntaxique définies dans globals.css : elles suivent le thème actif. */
function CodeBlock({ language, code }: { language: string; code: string }) {
  const grammar = ALIASES[language] ?? (language in LANGUAGES ? language : undefined);
  return (
    <figure className="niala-code">
      <figcaption>
        <span className="font-mono">{language || "code"}</span>
        <CopyCode text={code} />
      </figcaption>
      {grammar ? (
        <SyntaxHighlighter language={grammar} useInlineStyles={false} PreTag="pre" CodeTag="code">
          {code}
        </SyntaxHighlighter>
      ) : (
        <pre>
          <code>{code}</code>
        </pre>
      )}
    </figure>
  );
}

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

/** Formule en ligne $x$ : collée à ses dollars et non suivie d'un chiffre, pour ne jamais confondre un prix avec une formule. */
const INLINE_MATH = /(?<![\\$\w])\$(?=[^\s$])([^$\n]*?[^\s$\\])\$(?![\d$])/g;

function splitInlineMath(value: string): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(INLINE_MATH)) {
    if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
    out.push({ type: "inlineMath", value: m[1], data: { hName: "code", hProperties: { className: ["language-math", "math-inline"] }, hChildren: [{ type: "text", value: m[1] }] } });
    last = m.index + m[0].length;
  }
  if (last === 0) return [{ type: "text", value }];
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

/** Transforme les renvois [n] en liens de source et les $formules$ en maths. Le code n'est jamais touché : seuls les nœuds de texte sont lus. */
function remarkInline(known: Set<number>) {
  const split = (value: string): MdNode[] => {
    const out: MdNode[] = [];
    let last = 0;
    for (const m of value.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
      const numbers = m[1].split(",").map((x) => Number(x.trim()));
      if (!numbers.every((n) => known.has(n))) continue;
      if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
      for (const n of numbers) out.push({ type: "link", url: `#source-${n}`, children: [{ type: "text", value: String(n) }] });
      last = m.index + m[0].length;
    }
    if (last === 0) return [{ type: "text", value }];
    if (last < value.length) out.push({ type: "text", value: value.slice(last) });
    return out;
  };
  const walk = (node: MdNode) => {
    if (!node.children) return;
    if (node.type === "link") return;
    node.children = node.children.flatMap((child) => {
      if (child.type === "text" && child.value) return splitInlineMath(child.value).flatMap((n) => (n.type === "text" ? split(n.value ?? "") : [n]));
      walk(child);
      return [child];
    });
  };
  return () => (tree: MdNode) => walk(tree);
}

const SAFE_LINK = /^(https?:|mailto:)/i;

export const ChatMarkdown = memo(function ChatMarkdown({ text, citationNumbers, onSource }: { text: string; citationNumbers?: number[]; onSource?: (n: number) => void }) {
  const components: Components = {
    pre: ({ children }) => <>{children}</>,
    code({ className, children }) {
      const content = String(children ?? "");
      const language = /language-([\w+#-]+)/.exec(className ?? "")?.[1]?.toLowerCase();
      // Un bloc se reconnaît à sa langue ou à son retour à la ligne final ; le reste est du code en ligne.
      if (!language && !content.includes("\n")) return <code className="niala-inline-code">{content}</code>;
      return <CodeBlock language={language ?? ""} code={content.replace(/\n$/, "")} />;
    },
    table: ({ children }) => (
      <div className="niala-table">
        <table>{children}</table>
      </div>
    ),
    a({ href, children }) {
      const source = /^#source-(\d+)$/.exec(href ?? "");
      if (source) {
        return (
          <button type="button" className="niala-cite" aria-label={`Source ${source[1]}`} onClick={() => onSource?.(Number(source[1]))}>
            {children}
          </button>
        );
      }
      if (!href || !SAFE_LINK.test(href)) return <>{children}</>;
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
  };
  return (
    <div className="niala-answer">
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }], remarkInline(new Set(citationNumbers ?? []))]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
  // Seul le texte compte : les messages déjà reçus ne sont pas réanalysés à chaque fragment de la réponse en cours.
}, (a, b) => a.text === b.text && a.citationNumbers?.join() === b.citationNumbers?.join());
