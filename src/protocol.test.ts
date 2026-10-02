import { describe, expect, it } from 'vitest'
import { ApprovalSchema, BrowserSchema, DotEventSchema, RoutineSchema } from './protocol'

describe('protocol nullable fields', () => {
  it('accepts null thread IDs and nullable event payload members', () => {
    expect(DotEventSchema.safeParse({
      id: 1,
      thread_id: null,
      kind: 'turn/completed',
      payload: { item: { id: 'item-1', type: 'commandExecution', aggregatedOutput: null }, turn: { error: null } },
      created: 1,
    }).success).toBe(true)
    expect(ApprovalSchema.safeParse({ id: 'approval-1', thread_id: null, kind: 'permission', code: 'A1B2C3D4', payload: { reason: null }, created: 1 }).success).toBe(true)
  })

  it('accepts summary parts and nonnegative sparse summary indexes', () => {
    const base = { id: 2, thread_id: 'thread-1', kind: 'item/reasoning/summaryTextDelta', created: 2 }
    expect(DotEventSchema.safeParse({ ...base, payload: { itemId: 'reason-1', summaryIndex: 7, delta: 'part' } }).success).toBe(true)
    expect(DotEventSchema.safeParse({
      ...base, kind: 'item/completed',
      payload: { item: { id: 'reason-1', type: 'reasoning', summary: ['first', 'second'] } },
    }).success).toBe(true)
    expect(DotEventSchema.safeParse({ ...base, payload: { itemId: 'reason-1', summaryIndex: -1 } }).success).toBe(false)
  })

  it('preserves approval file changes', () => {
    const changes = [{ path: 'src/main.py', diff: '--- a/src/main.py\n+++ b/src/main.py\n+target' }]
    const result = ApprovalSchema.safeParse({
      id: 'approval-file', thread_id: 'thread-1', kind: 'item/fileChange/requestApproval',
      code: 'A1B2C3D4', payload: { changes }, created: 1,
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.payload.changes).toEqual(changes)
  })

  it('accepts nullable routine thread/error and browser element attributes', () => {
    expect(RoutineSchema.safeParse({ id: 'routine-1', title: 'Daily', prompt: 'Check', cron: '0 9 * * *', timezone: 'UTC', model: 'gpt-6.1-sol', enabled: 1, next_run: 1, thread_id: null, last_error: null }).success).toBe(true)
    expect(BrowserSchema.safeParse({ elements: [{ id: 1, tag: 'button', type: null, label: 'Continue', href: null }] }).success).toBe(true)
  })
})
