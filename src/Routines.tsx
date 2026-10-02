import { useCallback, useEffect, useState } from 'react'
import { Clock3, Plus, Trash2, ArrowUp, CalendarDays, ChevronRight, Sparkles } from 'lucide-react'
import { z } from 'zod'
import { api, post } from './api'
import { Choice, ConfirmDialog, Modal } from './Controls'
import { RoutineSchema, type Routine } from './protocol'

const schedules = [
  { value: '0 9 * * *', label: '每天上午 9:00', description: '每天整理资料或发送简报' },
  { value: '0 9 * * 1', label: '每周一上午 9:00', description: '一周一次的回顾与计划' },
  { value: '0 21 * * *', label: '每天晚上 21:00', description: '当天总结或复习提醒' },
  { value: '0 */6 * * *', label: '每 6 小时', description: '定期检查与更新' },
  { value: 'custom', label: '自定义时间', description: '使用 cron 表达式，最小间隔5分钟' },
]

export function Routines({ onError, onOpen }: { onError: (text: string) => void; onOpen: (id: string) => void }) {
  const [routines, setRoutines] = useState<Routine[]>([]), [showForm, setShowForm] = useState(false), [busy, setBusy] = useState(false)
  const [title, setTitle] = useState(''), [prompt, setPrompt] = useState(''), [schedule, setSchedule] = useState('0 9 * * *'), [customCron, setCustomCron] = useState('30 8 * * 1-5'), [timezone, setTimezone] = useState('Asia/Shanghai'), [model, setModel] = useState('deepseek/deepseek-v4.1-flash')
  const [deleting, setDeleting] = useState<Routine | null>(null), [removing, setRemoving] = useState(false)
  const refresh = useCallback(async () => { setRoutines(await api('/api/routines', z.array(RoutineSchema))) }, [])
  useEffect(() => { refresh().catch(e => onError(e.message)) }, [refresh, onError])
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      await post('/api/routines', { title, prompt, cron: schedule === 'custom' ? customCron.trim() : schedule, timezone, model })
      await refresh(); setShowForm(false); setTitle(''); setPrompt('')
    } catch (e) { onError(e instanceof Error ? e.message : '例行任务创建失败') } finally { setBusy(false) }
  }
  async function toggle(job: Routine) {
    try { await api(`/api/routines/${job.id}?enabled=${!job.enabled}`, z.unknown(), { method: 'PATCH' }); await refresh() } catch (e) { onError(e instanceof Error ? e.message : '任务开关操作失败') }
  }
  async function remove() {
    if (!deleting) return
    setRemoving(true)
    try { await api('/api/routines/' + deleting.id, z.unknown(), { method: 'DELETE' }); await refresh(); setDeleting(null) } catch (e) { onError(e instanceof Error ? e.message : '任务删除失败') } finally { setRemoving(false) }
  }
  return <section className="page-scroll routines">
    <div className="page-heading"><div><p className="eyebrow">SCHEDULED</p><h1>例行任务</h1><p>把重复的工作交给绒绒。</p></div><button className="primary" onClick={() => setShowForm(true)}><Plus size={18}/>新建任务</button></div>
    <div className="page-tabs"><span className="selected"><CalendarDays size={17}/>已安排<span className="count-badge">{routines.length}</span></span></div>
    <div className="routine-list">{routines.length ? routines.map(job => <article key={job.id} className="routine-card">
      <div className="routine-card-title"><span className="routine-icon"><Clock3 size={21}/></span><span><h3>{job.title}</h3><small>{schedules.find(item => item.value === job.cron)?.label || job.cron} · {job.timezone}</small></span><button className={`toggle ${job.enabled ? 'on' : ''}`} aria-label={`${job.enabled ? '暂停' : '启用'}${job.title}`} aria-pressed={Boolean(job.enabled)} onClick={() => toggle(job)}><span/></button></div>
      <p>{job.prompt}</p><div className="routine-meta"><span>{job.enabled ? `下次执行 ${new Date(job.next_run*1000).toLocaleString('zh-CN')}` : '已暂停'}</span><span>{job.model.startsWith('deepseek') ? 'DeepSeek' : 'Sol'} · high</span></div>
      {job.last_error && <div className="error-message">{job.last_error}</div>}
      <footer>{job.thread_id ? <button className="text-button" onClick={() => onOpen(job.thread_id!)}>查看结果<ChevronRight size={15}/></button> : <small>关闭手机后，任务仍会在服务器执行。</small>}<button className="icon-button" aria-label={`删除${job.title}`} onClick={() => setDeleting(job)}><Trash2 size={17}/></button></footer>
    </article>) : <div className="empty-state"><span className="empty-icon violet"><CalendarDays size={30}/></span><h3>让工作按时发生。</h3><p>每天的简报、每周的回顾、定期的调研。<br/>设定一次，就能在后台持续执行。</p><button className="secondary" onClick={() => setShowForm(true)}><Plus size={17}/>创建第一个任务</button></div>}</div>
    {showForm && <Modal title="新建例行任务" onClose={() => { if (!busy) setShowForm(false) }} className="routine-form-sheet">
      <form onSubmit={submit}>
        <label>任务名称<input required value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：每周行业简报"/></label>
        <label>任务内容<textarea required rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="告诉绒绒目标、来源和你想收到的结果"/></label>
        <div className="form-field"><span>执行时间</span><Choice label="执行时间" value={schedule} options={schedules} onChange={setSchedule}/></div>
        {schedule === 'custom' && <label>cron 表达式<input aria-label="自定义cron" required value={customCron} placeholder="例如：30 8 * * 1-5" onChange={e => setCustomCron(e.target.value)}/><small>分钟 小时 日 月 星期 · 最小间隔5分钟</small></label>}
        <div className="form-grid"><label>时区<input value={timezone} onChange={e => setTimezone(e.target.value)} required/></label><div className="form-field"><span>工作模型</span><Choice label="工作模型" value={model} onChange={setModel} options={[{ value: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek · high', icon: <Sparkles size={17}/> }, { value: 'gpt-6.1-sol', label: 'Sol · high', icon: <Sparkles size={17}/> }]}/></div></div>
        <p className="surface-note">按所选时区执行。关键操作仍需要你的授权；上一项工作未结束时，新任务会等待。</p><button className="primary full-width" disabled={busy}>{busy ? '正在创建…' : '创建任务'}<ArrowUp size={17}/></button>
      </form>
    </Modal>}
    {deleting && <ConfirmDialog title="删除例行任务？" description={`「${deleting.title}」将不再自动执行。已有对话和文件会保留。`} confirmLabel="删除任务" busy={removing} onCancel={() => setDeleting(null)} onConfirm={() => { void remove() }}/>}
  </section>
}
