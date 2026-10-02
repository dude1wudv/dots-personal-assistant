import { describe, expect, it } from 'vitest'
import { paragraphChunks } from './messages'

describe('paragraphChunks', () => {
  it('rejoins long English and Chinese paragraphs without losing whitespace or punctuation', () => {
    const english = ('First sentence, with spaces! Second sentence? ').repeat(12)
    const chinese = ('第一句，保留标点！第二句？这里有空格 和内容。').repeat(12)

    for (const text of [english, chinese]) {
      const chunks = paragraphChunks(text, 40)
      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.join('')).toBe(text)
    }
  })

  it('returns no chunks for empty input', () => {
    expect(paragraphChunks('')).toEqual([])
  })
})
