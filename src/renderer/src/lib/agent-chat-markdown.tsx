import React, { useMemo } from "react";

export function parseInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      nodes.push(<strong key={`${keyPrefix}-${idx}`}>{match[2]}</strong>);
    } else if (match[3]) {
      nodes.push(<em key={`${keyPrefix}-${idx}`}>{match[3]}</em>);
    } else if (match[4]) {
      nodes.push(<code key={`${keyPrefix}-${idx}`} className="agentChatInlineCode">{match[4]}</code>);
    }
    lastIndex = match.index + match[0].length;
    idx++;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export const coerceAgentChatText = (text: unknown): string => (
  typeof text === "string" && text.length > 0
    ? text
    : "No message content."
);

export function AgentChatMarkdown({ text }: { text: unknown }) {
  const safeText = coerceAgentChatText(text);
  const parts = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    const lines = safeText.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) nodes.push(<br key={`br-${i}`} />);
      nodes.push(...parseInlineMarkdown(lines[i], `line-${i}`));
    }
    return nodes;
  }, [safeText]);
  return <>{parts}</>;
}
