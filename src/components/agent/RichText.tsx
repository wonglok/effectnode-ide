import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

/** A deliberately small markdown subset for agent replies. */
export function RichText({ text }: { text: string }) {
  return <div className="rich-text">{renderBlocks(text)}</div>;
}

const INLINE_PATTERN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+]\((?:https?:\/\/)[^)\s]+\))/g;

function renderInline(text: string): ReactNode[] {
  const parts = text.split(INLINE_PATTERN);
  return parts.map((part, index) => {
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    const link = part.match(/^\[([^\]]+)]\((https?:\/\/[^)\s]+)\)$/);
    if (link) {
      return (
        <a key={index} href={link[2]} target="_blank" rel="noreferrer noopener">
          {link[1]}
        </a>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can be blocked; leave the button state unchanged.
    }
  };

  return (
    <div className="rich-code">
      <div className="rich-code-head">
        <span>{language || 'code'}</span>
        <button onClick={() => void copy()} title="Copy code">
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderTextBlock(text: string, key: number): ReactNode {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    nodes.push(
      <ul key={`ul-${key}-${nodes.length}`}>
        {list.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    list = [];
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    nodes.push(
      <p key={`p-${key}-${nodes.length}`}>
        {paragraph.map((line, index) => (
          <span key={index}>
            {renderInline(line)}
            {index < paragraph.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>
    );
    paragraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(4, heading[1].length);
      const content = renderInline(heading[2]);
      nodes.push(
        <div key={`h-${key}-${nodes.length}`} className={`rich-h rich-h${level}`}>
          {content}
        </div>
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      list.push(trimmed.replace(/^([-*]|\d+\.)\s+/, ''));
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      nodes.push(<hr key={`hr-${key}-${nodes.length}`} />);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return nodes.length > 0 ? nodes : null;
}

function renderBlocks(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const fence = /```([\w+-]*)\n([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = fence.exec(text))) {
    const before = text.slice(lastIndex, match.index);
    if (before) nodes.push(renderTextBlock(before, key++));
    nodes.push(<CodeBlock key={`code-${key++}`} language={match[1] ?? ''} code={match[2].replace(/\n$/, '')} />);
    lastIndex = match.index + match[0].length;
  }

  const rest = text.slice(lastIndex);
  if (rest) nodes.push(renderTextBlock(rest, key++));
  return nodes;
}
