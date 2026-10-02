import { describe, expect, it } from 'vitest'
import { getWorkProgress, reduceEvents } from './events'
import type { DotEvent } from './protocol'

const event = (id: number, kind: string, payload: Record<string, unknown>): DotEvent => ({
  id,
  thread_id: 'thread-1',
  kind,
  payload,
  created: id,
})

describe('getWorkProgress', () => {
  const progress = (...events: DotEvent[]) => getWorkProgress(events, true)
  const started = event(1, 'turn/started', {})
  const delta = (id: number, itemId: string, summaryIndex: number, text: string, kind = 'item/reasoning/summaryTextDelta') =>
    event(id, kind, { itemId, summaryIndex, delta: text })

  it('assembles summary parts by sparse index and lets completed summary replace streamed parts', () => {
    expect(progress(
      started,
      delta(2, 'reason-1', 2, 'third'),
      delta(3, 'reason-1', 0, 'first'),
      delta(4, 'reason-1', 2, ' part'),
      event(5, 'item/reasoning/summaryPartAdded', { itemId: 'reason-1', summaryIndex: 3 }),
      delta(6, 'reason-1', 3, ' fourth'),
    )).toEqual({ text: '思考 · fourth', mode: 'thinking' })

    expect(progress(
      started,
      delta(2, 'reason-1', 0, 'incremental'),
      event(3, 'item/completed', { item: { id: 'reason-1', type: 'reasoning', summary: ['final summary'] } }),
    )).toEqual({ text: '思考 · final summary', mode: 'thinking' })
  })

  it('ignores raw items, reasoning text, text deltas, and content', () => {
    expect(progress(
      started,
      event(2, 'item/started', { item: { id: 'raw', type: 'raw' } }),
      event(3, 'item/reasoning/textDelta', { itemId: 'r', delta: 'private reasoning' }),
      event(4, 'item/agentMessage/delta', { itemId: 'm', delta: 'assistant text' }),
      event(5, 'item/completed', { item: { id: 'reason-content-only', type: 'reasoning', content: 'private reasoning' } }),
    )).toBeNull()
  })

  it('does not expose raw bridge summaries when summaries are disabled, but keeps tool progress', () => {
    const events = [
      started,
      delta(2, 'reason-1', 0, 'bridge raw summary'),
      event(3, 'item/started', { item: { id: 'tool-1', type: 'commandExecution', command: 'run' } }),
    ]
    expect(getWorkProgress(events, false)).toEqual({ text: '使用终端', mode: 'working' })
    expect(getWorkProgress(events.slice(0, 2), false)).toBeNull()
  })

  it('resets only between turns and ignores steering user messages', () => {
    const prior = [
      event(1, 'dots/user/message', { text: 'initial user' }),
      event(2, 'turn/started', {}),
      delta(3, 'r', 0, 'current turn'),
      event(4, 'dots/user/message', { text: 'steering', steering: true }),
    ]
    expect(progress(...prior)).toEqual({ text: '思考 · current turn', mode: 'thinking' })
    expect(progress(
      started,
      delta(2, 'r', 0, 'before initial user'),
      event(3, 'dots/user/message', { text: 'initial user' }),
    )).toEqual({ text: '思考 · before initial user', mode: 'thinking' })

    const nextTurn = [
      ...prior,
      event(5, 'turn/completed', {}),
      event(6, 'dots/user/message', { text: 'new user' }),
      delta(7, 'new-reason', 0, 'new turn'),
    ]
    expect(progress(...nextTurn)).toEqual({ text: '思考 · new turn', mode: 'thinking' })
    expect(progress(...prior, event(8, 'turn/completed', {}))).toBeNull()
  })

  it('keeps still-running parallel tools visible after another tool completes and marks failures', () => {
    const running = [
      started,
      event(2, 'item/started', { item: { id: 'tool-a', type: 'commandExecution' } }),
      event(3, 'item/started', { item: { id: 'tool-b', type: 'webSearch' } }),
      event(4, 'item/completed', { item: { id: 'tool-a', type: 'commandExecution', status: 'completed' } }),
    ]
    expect(progress(...running)).toEqual({ text: '搜索资料', mode: 'working' })
    expect(progress(started,
      event(2, 'item/started', { item: { id: 'tool-a', type: 'webSearch' } }),
      event(3, 'item/completed', { item: { id: 'tool-a', type: 'webSearch', status: 'failed' } }),
    )).toEqual({ text: '未完成 · 搜索资料', mode: 'working' })
  })
})

describe('reduceEvents', () => {
  it('lets the final agent item replace streamed partial text', () => {
    const items = reduceEvents([
      event(1, 'item/agentMessage/delta', { itemId: 'message-1', delta: 'partial response' }),
      event(2, 'item/completed', { item: { id: 'message-1', type: 'agentMessage', text: 'complete response', status: 'completed' } }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'message-1', role: 'assistant', text: 'complete response', status: 'completed' })
  })

  it('retains command details and safely ignores unknown event kinds', () => {
    const items = reduceEvents([
      event(1, 'future/unknown', { text: 'must not leak into timeline' }),
      event(2, 'item/completed', { item: { id: 'command-1', type: 'commandExecution', command: 'echo safe', aggregatedOutput: 'safe output', status: 'completed' } }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'command-1', role: 'activity', type: 'commandExecution', text: 'echo safe', status: 'completed', data: { aggregatedOutput: 'safe output' } })
  })
  it('keeps answered choices on their original question and ignores duplicate answer echoes', () => {
    const asked = event(1, 'dots/question/asked', {
      question_id: 'question-1', question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }],
    })
    const answered = event(2, 'dots/question/answered', { question_id: 'question-1', status: 'answered', text: 'B' })
    const history = reduceEvents([asked, answered, answered])

    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      id: 'question-1', type: 'question',
      data: { question: { id: 'question-1', answer: 'B', status: 'answered' } },
    })
  })

  it('retains group speaker on question history and following assistant output', () => {
    const speaker = { id: 'bot-2', name: 'Second partner', color: 'blue' }
    const asked = event(1, 'dots/question/asked', {
      question_id: 'question-2', question: 'Continue?', options: [{ label: 'Yes' }], speaker,
    })
    const answered = event(2, 'dots/question/answered', { question_id: 'question-2', status: 'answered', text: 'Yes' })
    const reply = event(3, 'item/agentMessage/delta', { itemId: 'reply-1', delta: 'Continuing.', speaker })

    expect(reduceEvents([asked, answered, reply]).map(item => item.speaker)).toEqual([speaker, speaker])
  })
})
