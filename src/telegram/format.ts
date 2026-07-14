export function formatTelegramHtml(markdown: string): string {
  const lines = markdown.split("\n");

  return lines
    .map((line) => formatLine(line))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n");
}

function formatLine(line: string): string {
  const trimmed = line.trim();

  if (!trimmed) return "";
  if (/^---+$/.test(trimmed)) return "";

  const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
  if (heading) {
    return `<b>${formatInline(heading[1].trim())}</b>`;
  }

  const bullet = trimmed.match(/^[-*]\s+(.+)$/);
  if (bullet) {
    return `• ${formatInline(bullet[1].trim())}`;
  }

  const numbered = trimmed.match(/^(\d+)\.\s+(.+)$/);
  if (numbered) {
    return `${numbered[1]}. ${formatInline(numbered[2].trim())}`;
  }

  return formatInline(line);
}

function formatInline(value: string): string {
  const placeholders: string[] = [];
  let text = escapeHtml(value);

  text = text.replace(/`([^`]+)`/g, (_, code: string) => {
    const index = placeholders.push(`<code>${code}</code>`) - 1;
    return token(index);
  });

  text = text.replace(/\*\*([^*\n]+)\*\*/g, (_, bold: string) => {
    const index = placeholders.push(`<b>${bold}</b>`) - 1;
    return token(index);
  });

  text = text.replace(/\*([^*\n]+)\*/g, (_, italic: string) => {
    const index = placeholders.push(`<i>${italic}</i>`) - 1;
    return token(index);
  });

  text = text.replace(/^(&gt;\s?)(.+)$/g, (_, _marker: string, quote: string) => {
    const index = placeholders.push(`<blockquote>${quote}</blockquote>`) - 1;
    return token(index);
  });

  return placeholders.reduce((acc, html, index) => acc.replace(token(index), html), text);
}

function token(index: number): string {
  return `\u0000${index}\u0000`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
