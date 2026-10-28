const INLINE_MARKDOWN_PATTERN = /(\*\*[^*\r\n]+\*\*|\*[^*\r\n]+\*)/g;

function parseInline(value) {
  return value.split(INLINE_MARKDOWN_PATTERN).filter(Boolean).map((segment) => {
    if (segment.startsWith('**') && segment.endsWith('**')) {
      return Object.freeze({ type: 'strong', text: segment.slice(2, -2) });
    }
    if (segment.startsWith('*') && segment.endsWith('*')) {
      return Object.freeze({ type: 'emphasis', text: segment.slice(1, -1) });
    }
    return Object.freeze({ type: 'text', text: segment });
  });
}

export function parseSafeMarkdown(value) {
  if (typeof value !== 'string' || value.length === 0) return Object.freeze([]);
  const blocks = value.split(/\r?\n/u).map((line) => {
    const bullet = /^[-*]\s+(.+)$/u.exec(line.trim());
    if (bullet) return Object.freeze({ type: 'bullet', segments: Object.freeze(parseInline(bullet[1])) });
    if (line.trim() === '') return Object.freeze({ type: 'spacing', segments: Object.freeze([]) });
    return Object.freeze({ type: 'paragraph', segments: Object.freeze(parseInline(line)) });
  });
  return Object.freeze(blocks);
}
