import type { CodexItem, DotEvent, QuestionContent } from './protocol'
export type { DotEvent } from './protocol'
export interface ChatItem { id: string; role: 'user' | 'assistant' | 'activity'; text: string; type: string; created: number; status?: string; speaker?: { id: string; name: string; color: string }; data?: Partial<CodexItem> & { attachments?: string[]; question?: QuestionContent & { id: string; answer?: string; status?: string } } }
export function reduceEvents(events: DotEvent[]): ChatItem[] {
  const items = new Map<string, ChatItem>()
  const order: string[] = []
  let speaker: ChatItem['speaker']
  const put = (item: ChatItem) => { if (!items.has(item.id)) order.push(item.id); items.set(item.id, { ...item, speaker: item.speaker || items.get(item.id)?.speaker || speaker }) }
  for (const event of events) {
    const p = event.payload
    speaker = p.speaker
    if (event.kind === 'dots/user/message') {
      put({ id: `user-${event.id}`, role: 'user', text: p.text || '', type: 'message', created: event.created, data: { attachments: p.attachments } })
    } else if (event.kind === 'dots/question/asked' && p.question_id && p.question && p.options) {
      put({ id: p.question_id, role: 'assistant', text: p.question, type: 'question', created: event.created, data: { question: { id: p.question_id, question: p.question, options: p.options } } })
    } else if (event.kind === 'dots/question/answered' && p.question_id) {
      const previous = items.get(p.question_id)
      if (previous?.data?.question) put({ ...previous, data: { ...previous.data, question: { ...previous.data.question, status: p.status, answer: p.text || undefined } } })
    } else if (event.kind === 'item/agentMessage/delta') {
      const id = p.itemId
      if (!id) continue
      const previous = items.get(id)
      put({ id, role: 'assistant', text: (previous?.text || '') + (p.delta || ''), type: 'message', created: previous?.created || event.created })
    } else if (event.kind === 'item/started' || event.kind === 'item/completed') {
      const item = p.item
      if (!item) continue
      const previous = items.get(item.id)
      if (item.type === 'agentMessage') {
        put({ id: item.id, role: 'assistant', type: 'message', text: item.text || previous?.text || '', created: previous?.created || event.created, status: item.status, data: item })
      } else if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'plan'].includes(item.type)) {
        const text = item.type === 'commandExecution' ? item.command : item.type === 'fileChange' ? '整理工作区文件' : item.type === 'plan' ? '更新工作计划' : item.tool || item.query || '使用工具'
        put({ id: item.id, role: 'activity', text: text || '正在工作', type: item.type, created: previous?.created || event.created, status: item.status || (event.kind === 'item/completed' ? 'completed' : 'inProgress'), data: item })
      }
    } else if (event.kind === 'turn/completed' && p.turn?.error) {
      put({ id: `error-${event.id}`, role: 'activity', text: p.turn.error.message || '任务运行失败', type: 'error', created: event.created })
    } else if (event.kind === 'dots/routine/started') {
      put({ id: `routine-${event.id}`, role: 'activity', text: `开始例行任务 · ${p.title}`, type: 'routine', created: event.created })
    }
  }
  return order.map(id => items.get(id)!).filter(item => item.role !== 'assistant' || item.text)
}

export interface WorkProgress { text: string; mode: 'thinking' | 'working' }
const TOOL_LABELS: Record<string, string> = { browser: '使用浏览器', terminal: '使用终端', shell: '使用终端', read_file: '读取文件', write_file: '更新文件', schedule: '安排例行任务', remember: '更新记忆', ask_choice: '等待你选择' }
function toolLabel(item: CodexItem): string | null {
  if (item.type === 'commandExecution') return '使用终端'
  if (item.type === 'fileChange') return '更新文件'
  if (item.type === 'webSearch') return '搜索资料'
  if (item.type === 'plan') return '更新计划'
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') return TOOL_LABELS[item.tool?.split(/[./:]|__/).pop() || ''] || '使用工具'
  return null
}
function summaryLine(parts: string[]): string {
  const text = [...parts].reverse().find(part => part?.trim()) || ''
  return (text.split(/\r?\n/).find(line => line.trim()) || '').replace(/[*`#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180)
}

export function getWorkProgress(events: DotEvent[], allowSummary: boolean): WorkProgress | null {
  let active = false, latest: WorkProgress | null = null
  const summaries = new Map<string, string[]>(), tools = new Map<string, string>()
  const reset = () => { summaries.clear(); tools.clear(); latest = null }
  for (const event of events) {
    const p = event.payload
    if (event.kind === 'turn/started') {
      reset(); active = true
    } else if (event.kind === 'dots/user/message' && !p.steering && !active) {
      reset(); active = true
    } else if (event.kind === 'turn/completed') {
      reset(); active = false
    } else if (active && allowSummary && (event.kind === 'item/reasoning/summaryTextDelta' || event.kind === 'item/reasoning/summaryPartAdded')) {
      if (!p.itemId) continue
      const index = p.summaryIndex ?? 0
      if (index >= 64) continue
      const parts = summaries.get(p.itemId) || []
      parts[index] = ((parts[index] || '') + (p.delta || '')).slice(0, 1000)
      summaries.set(p.itemId, parts)
      const line = summaryLine(parts)
      if (line) latest = { text: `思考 · ${line}`, mode: 'thinking' }
    } else if (active && (event.kind === 'item/started' || event.kind === 'item/completed')) {
      const item = p.item
      if (!item) continue
      if (allowSummary && item.type === 'reasoning') {
        const parts = item.summary?.length ? item.summary : summaries.get(item.id) || []
        summaries.set(item.id, parts)
        const line = summaryLine(parts)
        if (line) latest = { text: `思考 · ${line}`, mode: 'thinking' }
      } else {
        const label = toolLabel(item)
        if (!label) continue
        if (event.kind === 'item/started') tools.set(item.id, label)
        else { tools.delete(item.id); latest = { text: `${item.status === 'failed' || item.status === 'declined' || item.error ? '未完成' : '已完成'} · ${label}`, mode: 'working' } }
      }
    }
  }
  const tool = [...tools.values()].pop()
  return active ? tool ? { text: tool, mode: 'working' } : latest : null
}
