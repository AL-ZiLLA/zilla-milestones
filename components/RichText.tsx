import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let list: string[] = [];

  function flushList() {
    if (list.length === 0) return;
    const items = list;
    list = [];
    nodes.push(
      <ul key={`list-${nodes.length}`} className="list-disc space-y-1 pl-5">
        {items.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>,
    );
  }

  for (const line of lines) {
    const item = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line.trim());
    if (item) {
      list.push(item[1]);
      continue;
    }
    flushList();
    if (!line.trim()) continue;
    nodes.push(
      <p key={`line-${nodes.length}`} className="whitespace-pre-wrap">
        {inline(line)}
      </p>,
    );
  }
  flushList();

  return <div className={className}>{nodes}</div>;
}
