// Only plain paragraph text is split. Markdown lists, tables, links and code
// retain their original parse tree and are never truncated or re-numbered.
export function paragraphChunks(text: string, limit = 140): string[] {
  if (!text) return []
  const chunks: string[] = []
  let current = ''
  const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)
  for (const { segment } of sentences) {
    if (current && current.length + segment.length > limit) { chunks.push(current); current = '' }
    if (segment.length <= limit) { current += segment; continue }
    for (const { segment: word } of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(segment)) {
      if (current && current.length + word.length > limit) { chunks.push(current); current = '' }
      current += word
    }
  }
  if (current) chunks.push(current)
  return chunks
}
