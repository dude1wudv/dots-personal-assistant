import { useEffect, useState } from 'react'
import { Activity, Check, ChevronRight, CircleAlert, Loader2 } from 'lucide-react'
import { api } from './api'
import { RunSchema, type Run } from './protocol'
import { z } from 'zod'

const STATUS: Record<string, string> = { starting: '准备中', running: '进行中', waiting: '等待授权', completed: '已结束', failed: '失败', interrupted: '已中断', cancelled: '已取消' }

export function Runs({ onError, onOpen }: { onError: (message: string) => void; onOpen: (threadId: string) => void }) {
  const [items, setItems] = useState<Run[]>([])
  useEffect(() => {
    let disposed = false
    async function refresh() {
      try {
        const result = await api('/api/runs?limit=80', z.object({ items: z.array(RunSchema) }))
        if (!disposed) setItems(result.items)
      } catch (error) { if (!disposed) onError((error as Error).message) }
    }
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => { disposed = true; clearInterval(timer) }
  }, [onError])
  return <section className="runs-page page-scroll">
    <div className="page-heading"><div><p className="eyebrow">ACTIVITY</p><h1>活动</h1><p>查看伙伴正在做什么，以及每次执行留下的真实结果。</p></div><Activity size={25}/></div>
    {!items.length && <div className="runs-empty"><Activity size={28}/><strong>还没有运行记录</strong><span>下一次任务开始后，会在这里留下可回溯的记录。</span></div>}
    <div className="run-list">{items.map(run => <article className="run-card" key={run.id}>
      <div className={`run-status ${run.status}`}><span>{['starting','running','waiting'].includes(run.status) ? <Loader2 size={16} className="spin"/> : run.status === 'completed' ? <Check size={16}/> : <CircleAlert size={16}/>}</span><small>{STATUS[run.status] || run.status}</small></div>
      <div className="run-main"><strong>{run.title}</strong><small>{run.kind === 'routine' ? '例行任务' : run.kind === 'group_member' ? '群聊成员' : '手动任务'} · {new Date(run.updated * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>{run.error && <p>{run.error}</p>}</div>
      {run.thread_id && <button className="icon-button" aria-label="打开真实对话" onClick={() => onOpen(run.thread_id!)}><ChevronRight size={18}/></button>}
    </article>)}</div>
    <p className="companion-note">“执行已结束”不等于目标已验收；文件与外部结果请回到真实对话核对。</p>
  </section>
}
