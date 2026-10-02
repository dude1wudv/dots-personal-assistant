import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import type { QuestionContent } from './protocol'

export function QuestionCard({ question, pending, onAnswer, onType }: {
  question: QuestionContent & { id: string; answer?: string; status?: string }
  pending: boolean
  onAnswer: (id: string, body: { option?: number; skip?: boolean }) => Promise<void>
  onType: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [selection, setSelection] = useState<{ text?: string; skipped?: boolean } | null>(null)
  async function choose(body: { option?: number; skip?: boolean }) {
    setBusy(true)
    try {
      await onAnswer(question.id, body)
      setSelection(body.skip ? { skipped: true } : { text: question.options[body.option!].label })
    } catch { /* Parent displays the request error; keep choices available for retry. */ }
    finally { setBusy(false) }
  }
  return <section className="question-card" aria-label="伙伴的问题" aria-busy={busy}>
    <header><h3>{question.question}</h3>{pending && !selection && <button className="icon-button" aria-label="跳过这个问题" disabled={busy} onClick={() => choose({ skip: true })}><X size={18}/></button>}</header>
    {question.answer || selection?.text ? <div className="question-answer"><span>{question.answer || selection?.text}</span><Check size={18}/></div> : pending && !selection ? <>
      <div className="question-options">{question.options.map((option, index) => <button key={option.label} disabled={busy} onClick={() => choose({ option: index })}><span className="option-letter">{String.fromCharCode(65 + index)}</span><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></button>)}</div>
      <button className="question-custom" disabled={busy} onClick={onType}>{busy ? <><Loader2 size={14} className="spin"/>正在继续…</> : '也可以直接打字回答'}</button>
    </> : <p className="question-ended">{question.status === 'skipped' || selection?.skipped ? '已跳过' : '问题已结束或过期，可继续对话'}</p>}
  </section>
}
