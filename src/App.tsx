import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { ArrowLeft, ArrowUp, Check, ChevronDown, ChevronRight, Clock3, FileText, FolderOpen, ImagePlus, Loader2, Menu, Mic, Monitor, PanelRight, Paperclip, Phone, PhoneOff, Plus, Search, Settings2, ShieldCheck, Sparkles, Square, X, Camera, MessageCircle } from 'lucide-react'
import { api, clearToken, isNative, native, post, restoreToken, saveToken } from './api'
import { getWorkProgress, reduceEvents, type ChatItem, type DotEvent } from './events'
import { Workspace } from './Workspace'
import { Routines } from './Routines'
import { Profile } from './Profile'
import { Choice, Modal, Notice } from './Controls'
import { z } from 'zod'
import { ApprovalSchema, AttachmentSchema, BotSchema, ConversationSchema, DotEventSchema, LoginSchema, MeSchema, type Answers, type Approval, type Bot, type Conversation, type Me } from './protocol'
import { Mascot } from './Mascot'
import { BotAvatar, Companions } from './Companions'
import { ChatMessage } from './ChatMessage'

const MODEL_NAMES: Record<string, string> = { 'gpt-6.1-sol': 'Sol · 深入', 'deepseek/deepseek-v4.1-flash': 'DeepSeek · 轻快' }
const STATUS: Record<string, string> = { idle: '随时在这里', running: '正在认真工作', waiting: '等你授权', failed: '任务遇到问题', interrupted: '任务已暂停' }


function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const result = await post('/api/login', { username, password, device: isNative ? 'Android · 绒点' : '浏览器 · 绒点' }, LoginSchema)
      await saveToken(result.token); setPassword(''); onLogin()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <main className="login-screen">
    <div className="login-brand"><span className="brand-dots"><i/><i/><i/></span><strong>绒点</strong><span>你的私人智能伙伴</span></div>
    <section className="login-card">
      <div className="login-avatar"><Mascot/></div><h1>你好，我是绒绒。</h1><p className="login-subtitle">一起把想法变成现实。</p>
      <form onSubmit={submit}>
        <label>账号<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="输入你的账号" required/></label>
        <label>密码<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="输入密码" required/></label>
        {error && <div className="error-message" role="alert">{error}</div>}
        <button className="primary login-button" disabled={busy}>{busy ? <Loader2 className="spin" size={19}/> : <ArrowUp size={19}/>}登录绒点</button>
      </form><p className="login-foot"><ShieldCheck size={14}/>私人空间 · 多设备同步</p>
    </section><p className="login-caption">MICROEDULAB · PERSONAL AGENT</p>
  </main>
}

function ApprovalCard({ approval, resolve }: { approval: Approval; resolve: (id: string, decision: string, answers?: Answers) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [answers, setAnswers] = useState<Record<string, string>>({})
  const p = approval.payload
  const questions = p.questions || []
  const properties = p.requestedSchema?.properties || {}
  const title = approval.kind.includes('memory') ? '记住这件小事' : approval.kind.includes('routine') ? '建立一个例行任务' : approval.kind.includes('UserInput') || approval.kind.includes('elicitation') ? '有件事想问你' : '这一步，想请你点头'
  async function decide(decision: string) {
    setBusy(true)
    try { await resolve(approval.id, decision, answers) } finally { setBusy(false) }
  }
  return <section className="approval-card">
    <div className="approval-heading"><span className="approval-icon"><ShieldCheck size={19}/></span><strong>{title}</strong><span className="approval-code">{approval.code}</span></div>
    <p>{p.reason || p.message || p.title || '请确认下方操作，授权仅适用于本次。'}</p>
    {p.note && <pre>{p.note}</pre>}{p.command && <pre>{p.command}</pre>}
    {p.changes?.map(change => <pre key={change.path}>{change.path}{'\n'}{change.diff || '文件变更'}</pre>)}
    {p.action && <p className="action-detail">浏览器 · {p.action}<code>{JSON.stringify(p.arguments)}</code></p>}
    {p.prompt && <div className="approval-detail">{p.prompt}<small>{p.cron} · {p.timezone}</small></div>}
    {questions.map(q => <div key={q.id} className="approval-question"><span>{q.question || q.header}</span>
      {q.options?.length ? <Choice label={q.question || q.header || '选择答案'} value={answers[q.id] || ''} onChange={value => setAnswers(a => ({ ...a, [q.id]: value }))} options={q.options.map(o => ({ value: o.label, label: o.label, description: o.description }))}/> : <input aria-label={q.question || q.header || q.id} value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}/>}
    </div>)}
    {Object.entries(properties).map(([key, field]) => <label key={key} className="approval-question">{field.title || key}<input value={answers[key] || ''} onChange={e => setAnswers(a => ({ ...a, [key]: e.target.value }))}/></label>)}
    {p.url && <a href={p.url} target="_blank" rel="noreferrer">打开授权页面</a>}
    <div className="approval-buttons"><button className="primary" disabled={busy} onClick={() => decide('accept')}><Check size={16}/>允许这次</button><button className="secondary" disabled={busy} onClick={() => decide('decline')}>暂不允许</button></div>
    <small>也可在对话中回复「授权 {approval.code}」</small>
  </section>
}

function MessageItem({ item, onError, animate, onGrowth }: { item: ChatItem; onError: (text: string) => void; animate?: boolean; onGrowth?: () => void }) {
  if (item.role === 'activity') return <details className={`activity-item ${item.type === 'error' ? 'failed' : ''}`}><summary>{item.type === 'routine' ? <Clock3 size={14}/> : item.status === 'inProgress' ? <Loader2 size={14} className="spin"/> : <Check size={14}/>}<span>{item.type === 'commandExecution' ? '使用终端' : item.type === 'mcpToolCall' ? '使用云电脑' : item.type === 'fileChange' ? '更新文件' : item.text}</span><ChevronDown size={13}/></summary><pre>{item.text}{item.data?.aggregatedOutput ? '\n' + item.data.aggregatedOutput : ''}{item.data?.error ? '\n' + JSON.stringify(item.data.error) : ''}{item.data?.changes ? '\n' + item.data.changes.map(c => `${c.path}\n${c.diff || ''}`).join('\n') : ''}</pre></details>
  return <ChatMessage item={item} onError={onError} animate={animate} onGrowth={onGrowth}/>
}

export default function App() {
  const [ready, setReady] = useState(false), [loggedIn, setLoggedIn] = useState(false), [me, setMe] = useState<Me | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([]), [current, setCurrent] = useState<string | null>(null), [events, setEvents] = useState<DotEvent[]>([]), [approvals, setApprovals] = useState<Approval[]>([])
  const [tab, setTab] = useState<'chat' | 'workspace' | 'routines' | 'profile' | 'companions'>('chat'), [sidebar, setSidebar] = useState(false), [detail, setDetail] = useState(false)
  const [text, setText] = useState(''), [model, setModel] = useState('gpt-6.1-sol'), [effort, setEffort] = useState('high'), [attachments, setAttachments] = useState<{ path: string; name: string }[]>([])
  const [sending, setSending] = useState(false), [menu, setMenu] = useState(false), [toast, setToast] = useState(''), [connected, setConnected] = useState(true), [search, setSearch] = useState('')
  const [voiceMode, setVoiceMode] = useState(false), [listening, setListening] = useState(false), [speaking, setSpeaking] = useState(false)
  const [showWorkStatus, setShowWorkStatus] = useState(localStorage.getItem('dots-work-status') !== 'false')
  const [searchMode, setSearchMode] = useState(false), [loadedThread, setLoadedThread] = useState<string | null>(null)
  const [bots, setBots] = useState<Bot[]>([]), [selectedBot, setSelectedBot] = useState('default'), [botSettings, setBotSettings] = useState<Bot | undefined>()
  const [outbox, setOutbox] = useState<{ id: string; threadId: string | null; text: string; attachments: { path: string; name: string }[]; state: 'sending' | 'sent' | 'failed'; created: number }[]>([])
  const openedAt = useRef(Date.now()/1000)
  const scrollRef = useRef<HTMLDivElement>(null), bottomRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLTextAreaElement>(null), fileRef = useRef<HTMLInputElement>(null), imageRef = useRef<HTMLInputElement>(null), cameraRef = useRef<HTMLInputElement>(null)
  const cursor = useRef(0), nearBottom = useRef(true), voiceRef = useRef(false), lastSpoken = useRef('')
  const searchRef = useRef<HTMLInputElement>(null)
  const searchQuery = search.trim().toLocaleLowerCase()
  const filteredConversations = useMemo(() => conversations.filter(c => c.title.toLocaleLowerCase().includes(searchQuery)), [conversations, searchQuery])
  const conversation = conversations.find(c => c.id === current)
  const visibleEvents = useMemo(() => loadedThread === current ? events : [], [events, loadedThread, current])
  const chatItems = useMemo(() => reduceEvents(visibleEvents), [visibleEvents])
  const progress = useMemo(() => getWorkProgress(visibleEvents, conversation?.model === 'gpt-6.1-sol'), [visibleEvents, conversation?.model])
  const relevantApprovals = approvals.filter(a => !a.thread_id || a.thread_id === current || conversation?.members?.some(m => m.thread_id === a.thread_id))
  const notify = useCallback((message: string) => setToast(message), [])
  const pendingMessages = outbox.filter(p => p.threadId === current && !visibleEvents.some(e => e.payload.client_id === p.id))
  const followReply = useCallback(() => { if (nearBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [])
  useEffect(() => { openedAt.current = Date.now()/1000 }, [current])
  useEffect(() => { if (!loggedIn) { setOutbox([]); return } const ids = new Set(events.map(e => e.payload.client_id)); setOutbox(list => list.filter(p => !ids.has(p.id))) }, [events, loggedIn])
  const refreshBots = useCallback(async () => { setBots(await api('/api/bots', z.array(BotSchema))); setMe(await api('/api/me', MeSchema)) }, [])
  useEffect(() => { if (loggedIn) refreshBots().catch(e => notify(e.message)) }, [loggedIn, refreshBots, notify])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`
  }, [text, tab, ready, loggedIn])
  useEffect(() => { if (!sidebar) setSearchMode(false) }, [sidebar])
  useEffect(() => {
    const pause = () => {
      if (document.hidden) document.documentElement.dataset.dotsHidden = 'true'
      else delete document.documentElement.dataset.dotsHidden
    }
    pause()
    document.addEventListener('visibilitychange', pause)
    return () => { document.removeEventListener('visibilitychange', pause); delete document.documentElement.dataset.dotsHidden }
  }, [])
  useEffect(() => { restoreToken().then(value => setLoggedIn(Boolean(value))).catch(e => notify(e.message)).finally(() => setReady(true)) }, [notify])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer) }, [toast])
  useEffect(() => {
    const invalidate = () => { clearToken().catch(() => {}); setLoggedIn(false); setMe(null) }
    window.addEventListener('dots-unauthorized', invalidate); return () => window.removeEventListener('dots-unauthorized', invalidate)
  }, [])
  useEffect(() => {
    if (!loggedIn) return
    api('/api/me', MeSchema).then(setMe).catch(e => notify(e.message))
    if (isNative && localStorage.getItem('dots-background') === 'true') native.background({ enabled: true }).catch(e => notify(e.message))
    let disposed = false, timer: number, initial = true
    async function refresh() {
      try {
        const [list, pending] = await Promise.all([api('/api/conversations', z.array(ConversationSchema)), api('/api/approvals', z.array(ApprovalSchema))])
        if (!disposed) {
          setConversations(list); setApprovals(pending); setConnected(true)
          if (initial) {
            const active = list.find(c => c.status === 'waiting') || list.find(c => c.status === 'running')
            if (active) { setCurrent(active.id); setModel(active.model); setEffort(active.effort) }
            initial = false
          }
        }
      } catch { if (!disposed) setConnected(false) }
      if (!disposed) timer = window.setTimeout(refresh, document.hidden ? 10000 : 2000)
    }
    refresh(); return () => { disposed = true; clearTimeout(timer) }
  }, [loggedIn, notify])
  useEffect(() => {
    if (!loggedIn || !current) { setEvents([]); setLoadedThread(null); return }
    let disposed = false, timer: number; cursor.current = 0; setEvents([]); setLoadedThread(null)
    async function refresh() {
      try {
        const data = await api(`/api/events?thread_id=${encodeURIComponent(current!)}&after=${cursor.current}`, z.array(DotEventSchema))
        if (!disposed && data.length) {
          cursor.current = data[data.length - 1].id
          setEvents(existing => [...existing, ...data])
        }
        if (!disposed) { setLoadedThread(current); setConnected(true) }
        if (!disposed) timer = window.setTimeout(refresh, data.length === 500 ? 50 : document.hidden ? 8000 : 1000)
      } catch { if (!disposed) { setConnected(false); timer = window.setTimeout(refresh, 4000) } }
    }
    refresh(); return () => { disposed = true; clearTimeout(timer) }
  }, [loggedIn, current])
  useEffect(() => { if (nearBottom.current) bottomRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, [chatItems, relevantApprovals.length, outbox])
  useEffect(() => { voiceRef.current = voiceMode }, [voiceMode])
  useEffect(() => {
    if (!isNative) return
    const listener = CapacitorApp.addListener('backButton', () => {
      if (!window.dispatchEvent(new Event('dots-dismiss-overlay', { cancelable: true }))) return
      if (voiceRef.current) setVoiceMode(false)
      else if (sidebar) setSidebar(false)
      else if (tab !== 'chat') setTab('chat')
      else if (current) setCurrent(null)
      else CapacitorApp.minimizeApp()
    })
    return () => { listener.then(l => l.remove()) }
  }, [tab, sidebar, current])

  async function create(value: string) {
    const c = await post('/api/conversations', { title: value.trim().slice(0, 28) || '新对话', model, bot_id: selectedBot }, ConversationSchema)
    setConversations(list => [c, ...list]); setCurrent(c.id); setSidebar(false); setTab('chat'); return c.id
  }
  async function send(value = text) {
    if (!value.trim() || sending) return
    const clientId = crypto.randomUUID(), draft = value.trim(), files = attachments
    setSending(true); nearBottom.current = true
    setOutbox(list => [...list, { id: clientId, threadId: current, text: draft, attachments: files, state: 'sending', created: Date.now()/1000 }])
    setText(''); setAttachments([]); inputRef.current?.blur()
    if (isNative) native.hideKeyboard().catch(() => {})
    try {
      const id = current || await create(draft)
      setOutbox(list => list.map(p => p.id === clientId ? { ...p, threadId: id } : p))
      await post(`/api/conversations/${id}/message`, { text: draft, model, effort, attachments: files.map(a => a.path), client_id: clientId })
      setOutbox(list => list.map(p => p.id === clientId ? { ...p, state: 'sent' } : p))
    } catch (e) {
      setOutbox(list => list.map(p => p.id === clientId ? { ...p, state: 'failed' } : p))
      notify((e as Error).message)
    } finally { setSending(false) }
  }
  async function resolve(id: string, decision: string, answers: Answers = {}) {
    try { await post('/api/approvals/' + encodeURIComponent(id), { decision, answers }); setApprovals(list => list.filter(a => a.id !== id)) } catch (e) { notify((e as Error).message); throw e }
  }
  async function upload(file: File | undefined) {
    setMenu(false); if (!file) return
    if (file.size > 20 * 1024 * 1024) { notify('附件最大20MB'); return }
    if (attachments.length >= 8) { notify('每条消息最多8个附件'); return }
    const body = new FormData(); body.append('file', file)
    try { const uploaded = await api('/api/attachments', AttachmentSchema, { method: 'POST', body }); setAttachments(a => [...a, uploaded]) } catch (e) { notify((e as Error).message) }
  }
  async function dictate(sendImmediately = false) {
    if (listening) return
    setListening(true)
    try {
      if (!isNative) throw new Error('语音输入请使用Android应用；网页端可直接键入')
      const result = await native.listen()
      if (sendImmediately && voiceRef.current) await send(result.text)
      else setText(old => old + result.text)
    } catch (e) { notify((e as Error).message) } finally { setListening(false) }
  }
  useEffect(() => {
    if (!voiceMode || conversation?.status !== 'idle') return
    const last = [...chatItems].reverse().find(item => item.role === 'assistant')
    if (!last || last.id === lastSpoken.current || !isNative) return
    lastSpoken.current = last.id; setSpeaking(true)
    native.speak({ text: last.text.slice(0, 5000) }).then(() => { if (voiceRef.current) dictate(true) }).catch(e => notify(e.message)).finally(() => setSpeaking(false))
  }, [voiceMode, conversation?.status, chatItems])

  if (!ready) return <div className="splash"><Mascot state="thinking"/><span>绒点</span></div>
  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)}/>
  const activeBot = bots.find(b => b.id === (conversation?.bot_id || selectedBot))
  const name = conversation?.members ? conversation.title : activeBot?.name || me?.profile.name || '绒绒'
  const active = conversation && ['running', 'waiting'].includes(conversation.status)
  const waiting = conversation?.status === 'waiting' || relevantApprovals.length > 0
  const progressText = !connected ? '网络断开 · 重连中' : waiting ? '等待你的授权' : conversation?.status === 'running' ? progress?.text || '正在思考' : sending ? '正在发送' : STATUS[conversation?.status || 'idle'] || '随时在这里'
  const mascotState = speaking ? 'speaking' : listening ? 'listening' : !connected ? 'offline' : waiting ? 'waiting' : active || sending ? progress?.mode || 'thinking' : 'idle'
  const openTab = (next: typeof tab) => { setTab(next); setSidebar(false); setDetail(false) }
  const chat = <section className="chat-column">
    <header className={`topbar ${showWorkStatus ? 'with-progress' : ''}`}>
      <button className="icon-button navigation-button" aria-label="打开导航" onClick={() => setSidebar(true)}><Menu size={21}/></button>
      <button className={`topbar-companion tone-${activeBot?.color || 'sage'}`} aria-label="伙伴设置" onClick={() => { if (conversation?.members) setDetail(true); else { setBotSettings(activeBot); openTab('companions') } }}><Mascot state={mascotState}/><strong>{name}</strong></button>
      <div className="topbar-actions">
        <button className={`icon-button ${tab === 'workspace' ? 'pressed' : ''}`} aria-label={tab === 'workspace' ? '返回对话' : '打开云电脑'} onClick={() => openTab(tab === 'workspace' ? 'chat' : 'workspace')}><Monitor size={19}/></button>
        <button className="icon-button" aria-label="语音聊天" onClick={() => setVoiceMode(true)}><Phone size={19}/></button>
        <button className="icon-button detail-button" aria-label="任务与资料" onClick={() => setDetail(!detail)}><PanelRight size={19}/></button>
      </div>
      {showWorkStatus && <div className="companion-progress" data-state={mascotState} role="status"><span className="progress-dot"/><span title={progressText}>{progressText}</span></div>}
    </header>
    <div className="chat-scroll" ref={scrollRef} onScroll={e => { const el = e.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150 }}>
      {current && loadedThread !== current && !pendingMessages.length ? <div className="history-loading" role="status"><Loader2 size={16} className="spin"/>{connected ? '加载对话' : '重连后加载对话'}</div> : !chatItems.length && !pendingMessages.length && !active && !sending ? <section className="welcome">
        <p className="conversation-date">今天</p>
        <article className="chat-message assistant"><div className="message-content"><p>你好，我是{name}。想从哪件事开始？</p><p>你可以把任务、资料或一个想法发给我。需要你决定的时候，我会来找你。</p></div></article>
        <div className="starter-grid">{[
          { title: '调研一个主题', text: '请帮我调研一个主题，先问我想了解什么，再给出有来源的结论。', icon: <Search size={17}/> },
          { title: '完成一个项目', text: '我想把一个想法做成可交付作品，请先帮我明确目标和验收标准。', icon: <Sparkles size={17}/> },
          { title: '记住我的偏好', text: '我想告诉你一些我的工作偏好，请先问我，并经我授权后保存长期记忆。', icon: <MessageCircle size={17}/> },
          { title: '安排定时任务', text: '帮我安排一个后台例行任务，先问我做什么、什么时候做，再让我授权。', icon: <Clock3 size={17}/> },
        ].map(s => <button key={s.title} onClick={() => { setText(s.text); inputRef.current?.focus() }}>{s.icon}<span>{s.title}</span><ArrowUp size={15}/></button>)}</div>
      </section> : <div className="messages">
        <div className="conversation-date">{new Date((conversation?.updated || Date.now()/1000) * 1000).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</div>
        {chatItems.map(item => <div key={item.id} className="chat-entry">{item.speaker && item.role === 'assistant' && <div className="message-speaker"><BotAvatar color={item.speaker.color}/><span>{item.speaker.name}</span></div>}<MessageItem item={item} onError={notify} animate={item.created >= openedAt.current} onGrowth={followReply}/></div>)}
        {pendingMessages.map(p => <div key={p.id} className="pending-message"><ChatMessage item={{ id: p.id, role: 'user', text: p.text, type: 'message', created: p.created, data: { attachments: p.attachments.map(a => a.path) } }} onError={notify}/><div className={`send-status ${p.state}`} role="status">{p.state === 'sending' ? '正在发送…' : p.state === 'sent' ? '已提交 · 同步中' : '发送未确认 · 请先检查对话，避免重复发送'}{p.state === 'failed' && <button onClick={() => { setText(p.text); setAttachments(p.attachments); setOutbox(list => list.filter(v => v.id !== p.id)); inputRef.current?.focus() }}>恢复草稿</button>}</div></div>)}
      </div>}
      <div className="approval-list">{relevantApprovals.map(a => <div key={a.id}>{conversation?.members && <p className="approval-speaker">{conversation.members.find(m => m.thread_id === a.thread_id)?.name || '伙伴'} 请求授权</p>}<ApprovalCard approval={a} resolve={resolve}/></div>)}</div>
      {active && <div className="typing-indicator" role="status"><Mascot state={mascotState}/><span>{conversation?.members?.find(m => ['running', 'waiting'].includes(m.status))?.name} {waiting ? '等待你的授权' : showWorkStatus ? progressText : `${name}正在工作`}</span></div>}
      <div ref={bottomRef}/>
    </div>
    <div className="composer-area">
      <div className="composer-options">
        <Choice compact label="选择模型" value={model} onChange={value => { setModel(value); setEffort('high') }} options={(me?.models || []).map(value => ({ value, label: MODEL_NAMES[value] || value, description: value.includes('deepseek') ? '轻快响应，适合日常任务' : '深入分析与复杂任务', icon: <Sparkles size={17}/> }))}/>
        <Choice compact label="思考强度" value={effort} onChange={setEffort} options={(model.includes('deepseek') ? ['low','high'] : ['low','medium','high','xhigh']).map(value => ({ value, label: `思考 ${value}` }))}/>
        {active && <button className="stop-button" onClick={() => post(`/api/conversations/${current}/stop`).catch(e => notify(e.message))}><Square size={12}/>停止</button>}
      </div>
      {attachments.length > 0 && <div className="composer-attachments">{attachments.map(a => <span key={a.path}><Paperclip size={15}/><span>{a.name}</span><button className="icon-button" aria-label={`移除附件${a.name}`} onClick={() => setAttachments(list => list.filter(x => x.path !== a.path))}><X size={15}/></button></span>)}</div>}
      <div className="composer">
        <button className="icon-button" aria-label="添加附件" onClick={() => setMenu(true)}><Plus size={22}/></button>
        <textarea ref={inputRef} rows={1} aria-label="消息内容" value={text} onChange={e => setText(e.target.value)} placeholder={`发消息给${name}`} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !isNative && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}/>
        <button className={`icon-button microphone ${listening ? 'recording' : ''}`} aria-label="语音输入" onClick={() => dictate()} disabled={listening}><Mic size={20}/></button>
        {text.trim() ? <button className="send-button" aria-label="发送消息" disabled={sending} onClick={() => send()}>{sending ? <Loader2 size={19} className="spin"/> : <ArrowUp size={22}/>}</button> : null}
      </div>
      <p className="composer-footnote">关键操作先授权 · 结果请核对</p>
    </div>
  </section>
  return <div className="app-shell">
    <nav className="nav-rail" aria-label="主要导航">
      <button className="rail-brand" aria-label="绒点首页" onClick={() => { setCurrent(null); openTab('chat') }}><span className="brand-dots"><i/><i/><i/></span></button>
      <button className={`icon-button ${tab === 'chat' ? 'selected' : ''}`} aria-label="对话记录" onClick={() => setSidebar(true)}><MessageCircle size={21}/></button>
      <button className={`icon-button ${tab === 'companions' ? 'selected' : ''}`} aria-label="伙伴与群聊" onClick={() => { setBotSettings(undefined); openTab('companions') }}><Plus size={21}/></button>
      <button className={`icon-button ${tab === 'workspace' ? 'selected' : ''}`} aria-label="工作空间" onClick={() => openTab('workspace')}><Monitor size={21}/></button>
      <button className={`icon-button ${tab === 'routines' ? 'selected' : ''}`} aria-label="例行任务" onClick={() => openTab('routines')}><Clock3 size={21}/></button>
      <button className="icon-button rail-settings" aria-label="设置" onClick={() => openTab('profile')}><Settings2 size={21}/></button>
    </nav>
    {sidebar && <button aria-label="关闭导航" className="sidebar-scrim" onClick={() => setSidebar(false)}/>}
    <aside className={`sidebar ${sidebar ? 'open' : ''} ${searchMode ? 'searching' : ''}`} aria-hidden={!sidebar} hidden={!sidebar}>
      <div className="sidebar-top">{searchMode && <button className="icon-button" aria-label="返回导航" onClick={() => { searchRef.current?.blur(); setSearchMode(false); setSearch('') }}><ArrowLeft size={20}/></button>}<span className="wordmark">{searchMode ? '搜索对话' : '绒点'}</span><button className="icon-button" aria-label="关闭导航面板" onClick={() => setSidebar(false)}><X size={20}/></button></div>
      <button className="new-conversation" onClick={() => { setCurrent(null); setText(''); openTab('chat') }}><Plus size={18}/>新对话</button>
      <button className="companion-tile" onClick={() => { setCurrent(null); openTab('chat') }}><Mascot state={mascotState}/><span><strong>{name}</strong><small><i className={connected ? 'status-dot' : 'status-dot offline'}/>{connected ? '在线' : '重新连接中'}</small></span></button>
      <button className="companions-nav" onClick={() => { setBotSettings(undefined); openTab('companions') }}><Plus size={18}/>伙伴与群聊<ChevronRight size={16}/></button>
      <div className="search-box"><Search size={17}/><input ref={searchRef} type="search" enterKeyHint="search" aria-label="搜索对话" value={search} onFocus={() => setSearchMode(true)} onChange={e => setSearch(e.target.value)} placeholder="搜索对话"/>{search && <button className="icon-button search-clear" aria-label="清除搜索" onClick={() => { setSearch(''); searchRef.current?.focus() }}><X size={15}/></button>}</div>
      <div className="section-label">{searchQuery ? '搜索结果' : '最近对话'}<span aria-live="polite">{filteredConversations.length}</span></div>
      <div className="conversation-list">{filteredConversations.map(c => <button key={c.id} className={current === c.id ? 'selected' : ''} onClick={() => { searchRef.current?.blur(); setCurrent(c.id); setSelectedBot(c.bot_id); setModel(c.model); setEffort(c.effort); openTab('chat'); nearBottom.current = true }}>
        <span className="conversation-symbol">{c.status === 'waiting' ? <ShieldCheck size={18}/> : c.status === 'running' ? <Loader2 className="spin" size={18}/> : <MessageCircle size={18}/>}</span><span><strong>{c.title}</strong><small>{c.members ? `${c.members.length} 位伙伴 · ` : `${bots.find(b => b.id === c.bot_id)?.name || '绒绒'} · `}{STATUS[c.status] || c.status}</small></span>
      </button>)}{!filteredConversations.length && <p className="search-empty" role="status">{searchQuery ? '没有找到对话' : '还没有对话'}</p>}</div>
      <div className="sidebar-bottom"><button onClick={() => openTab('workspace')}><Monitor size={18}/>电脑与文件<ChevronRight size={16}/></button><button onClick={() => openTab('routines')}><Clock3 size={18}/>例行任务<ChevronRight size={16}/></button><button onClick={() => openTab('profile')}><Settings2 size={18}/>设置<ChevronRight size={16}/></button></div>
    </aside>
    <main className={`main-panel ${tab === 'workspace' ? 'workspace-active' : ''}`}>
      {tab !== 'chat' && tab !== 'profile' && <header className="page-topbar"><button className="icon-button" aria-label="返回对话" onClick={() => openTab('chat')}><ArrowLeft size={21}/></button><span>{tab === 'workspace' ? '工作空间' : tab === 'companions' ? '伙伴与群聊' : '例行任务'}</span><button className="icon-button" aria-label="打开导航" onClick={() => setSidebar(true)}><Menu size={21}/></button></header>}
      <div className={`work-layout ${tab === 'workspace' ? 'split' : ''}`}>
        {(tab === 'chat' || tab === 'workspace') && chat}
        {tab === 'workspace' && <Workspace onError={notify}/>}
        {tab === 'companions' && <Companions bots={bots} initialBot={botSettings} onRefresh={refreshBots} onError={notify} onChat={bot => { setSelectedBot(bot.id); setCurrent(null); setText(''); setAttachments([]); openTab('chat') }} onGroup={group => { setConversations(list => [group, ...list]); setCurrent(group.id); setText(''); setAttachments([]); setModel(group.model); setEffort(group.effort); openTab('chat') }}/>}
        {tab === 'routines' && <Routines onError={notify} onOpen={id => { setCurrent(id); openTab('chat') }}/>}
        {tab === 'profile' && <Profile me={me} onUpdate={setMe} onError={notify} onBack={() => openTab('chat')} onNavigation={() => setSidebar(true)} showWorkStatus={showWorkStatus} onWorkStatusChange={enabled => { localStorage.setItem('dots-work-status', String(enabled)); setShowWorkStatus(enabled) }} onLogout={async () => { await post('/api/logout').catch(() => {}); await clearToken(); setLoggedIn(false); setCurrent(null); setEvents([]) }}/>}
      </div>
    </main>
    {detail && <Modal title="任务与资料" className="details-sheet" onClose={() => setDetail(false)}>
      <div className="detail-summary"><Mascot state={mascotState}/><span><strong>{name}</strong><small>{connected ? '在线，随时可以继续工作' : '正在重新连接'}</small></span></div>
      {conversation?.members && <div className="group-members">{conversation.members.map(m => <div key={m.bot_id}><BotAvatar color={bots.find(b => b.id === m.bot_id)?.color}/><span>{m.name}</span><small>{STATUS[m.status] || m.status}</small></div>)}</div>}
      <div className="detail-tabs"><button onClick={() => openTab('workspace')}>电脑与文件</button><button onClick={() => openTab('routines')}>例行任务</button><button onClick={() => openTab('profile')}>设置</button></div>
      <h3>当前任务</h3><p className="detail-task">{conversation?.title || '还没有选择任务'}<small>{conversation ? STATUS[conversation.status] : '从对话中告诉我你想做什么'}</small></p>
      <button className="computer-card" onClick={() => openTab('workspace')}><Monitor size={23}/><span><strong>{name}的电脑</strong><small>查看浏览器、接管操作与下载文件</small></span><ChevronRight size={18}/></button>
      {!conversation?.members && <><h3>长期记忆</h3><p className="memory-preview">{activeBot?.memory || '还没有保存偏好。你可以在对话中告诉我。'}</p><button className="text-button" onClick={() => { setBotSettings(activeBot); openTab('companions') }}>管理记忆<ChevronRight size={15}/></button></>}
    </Modal>}
    {menu && <Modal title="添加到对话" className="attachment-sheet" onClose={() => setMenu(false)}><div className="attachment-options">
      <button onClick={() => { setMenu(false); fileRef.current?.click() }}><span className="attachment-option-icon blue"><FolderOpen size={24}/></span><span><strong>上传文件</strong><small>文档、资料与代码 · 最大20MB</small></span><ChevronRight size={17}/></button>
      <button onClick={() => { setMenu(false); imageRef.current?.click() }}><span className="attachment-option-icon violet"><ImagePlus size={24}/></span><span><strong>选择图片</strong><small>从相册添加参考图片</small></span><ChevronRight size={17}/></button>
      <button onClick={() => { setMenu(false); cameraRef.current?.click() }}><span className="attachment-option-icon coral"><Camera size={24}/></span><span><strong>拍照</strong><small>拍下你想一起处理的内容</small></span><ChevronRight size={17}/></button>
    </div></Modal>}
    <input type="file" className="hidden" ref={fileRef} onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }}/><input type="file" accept="image/*" className="hidden" ref={imageRef} onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }}/><input type="file" accept="image/*" capture="environment" className="hidden" ref={cameraRef} onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }}/>
    {toast && <Notice message={toast} onClose={() => setToast('')}/>}
    {voiceMode && <Modal title={`与${name}语音聊天`} className="voice-sheet" onClose={() => { setVoiceMode(false); native.stopSpeaking().catch(() => {}) }}>
      <div className="voice-mascot"><Mascot state={mascotState}/></div><h3>{speaking ? '正在说话' : listening ? '正在聆听' : active ? '正在处理你的任务' : '准备开始聊天'}</h3><p>语音转为文字，任务和授权会保留在对话中。</p>
      <div className="voice-controls"><button className={`voice-mic ${listening ? 'recording' : ''}`} aria-label="开始语音输入" disabled={listening || speaking} onClick={() => dictate(true)}><Mic size={24}/></button><button className="voice-end" aria-label="结束语音聊天" onClick={() => { setVoiceMode(false); native.stopSpeaking().catch(() => {}) }}><PhoneOff size={23}/></button></div>
    </Modal>}
  </div>
}
