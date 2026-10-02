import { useEffect, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, Download, FileText, Folder, Globe, Keyboard, Loader2, Monitor, RefreshCw, ShieldCheck } from 'lucide-react'
import { api, download, post } from './api'
import { Choice, Modal } from './Controls'
import { BrowserSchema, FileListSchema, type BrowserState } from './protocol'

export function Workspace({ onError }: { onError: (message: string) => void }) {
  const [tab, setTab] = useState<'computer' | 'files'>('computer'), [screen, setScreen] = useState<BrowserState>({}), [snapshot, setSnapshot] = useState<BrowserState>({}), [url, setUrl] = useState('https://www.wikipedia.org'), [busy, setBusy] = useState(false)
  const [folder, setFolder] = useState(''), [files, setFiles] = useState<ReturnFile[]>([]), [value, setValue] = useState(''), [selected, setSelected] = useState<number | null>(null), [inspector, setInspector] = useState(false)
  async function refresh() {
    const [image, dom] = await Promise.all([api('/api/computer', BrowserSchema), post('/api/computer', { action: 'snapshot', arguments: {} }, BrowserSchema)])
    setScreen(image); setSnapshot(dom)
  }
  async function action(action: string, args: Record<string, string | number> = {}) {
    if (busy) return
    setBusy(true)
    try {
      const result = await post('/api/computer', { action, arguments: args }, BrowserSchema)
      if (result.error) throw new Error(result.error)
      setSnapshot(result); await refresh()
    } catch (e) { onError(e instanceof Error ? e.message : '电脑操作失败') } finally { setBusy(false) }
  }
  useEffect(() => {
    if (tab === 'computer') { refresh().catch(e => onError(e.message)); return }
    api('/api/files?path=' + encodeURIComponent(folder), FileListSchema).then(data => setFiles(data.items)).catch(e => onError(e.message))
  }, [tab, folder, onError])
  const inputOptions = (snapshot.elements || []).filter(e => ['input', 'textarea', 'select'].includes(e.tag)).map(e => ({ value: String(e.id), label: e.label || `输入框 ${e.id}`, description: e.type === 'password' ? '密码输入框 · 内容不会发送到对话' : undefined }))
  return <section className="workspace page-scroll">
    <div className="workspace-heading"><span className="workspace-icon"><Monitor size={19}/></span><div><h1>绒绒的电脑</h1><p>浏览器与文件，一直在线。</p></div><span className="connected-badge"><i className="status-dot"/>私人空间</span></div>
    <div className="page-tabs"><button className={tab === 'computer' ? 'selected' : ''} onClick={() => setTab('computer')}><Globe size={17}/>浏览器</button><button className={tab === 'files' ? 'selected' : ''} onClick={() => setTab('files')}><Folder size={17}/>文件</button></div>
    {tab === 'computer' ? <>
      <div className="computer-desktop"><div className="browser-window">
        <div className="browser-titlebar"><span className="window-dots"><i/><i/><i/></span><span><Globe size={13}/>{screen.title || '私人云浏览器'}</span></div>
        <div className="computer-toolbar"><button className="icon-button" aria-label="网页后退" disabled={busy} onClick={() => action('back')}><ArrowLeft size={17}/></button><button className="icon-button" aria-label="刷新电脑画面" disabled={busy} onClick={() => refresh().catch(e => onError(e.message))}><RefreshCw size={16}/></button><form onSubmit={e => { e.preventDefault(); action('navigate', { url }) }}><ShieldCheck size={14}/><input aria-label="打开网址" value={url} onChange={e => setUrl(e.target.value)} placeholder="输入公网网址"/><button aria-label="前往网页" disabled={busy}>{busy ? <Loader2 className="spin" size={16}/> : <ArrowUp size={16}/>}</button></form></div>
        <div className="computer-stage">{screen.image ? <img src={'data:image/png;base64,' + screen.image} alt="私人云浏览器实时画面，可点击操作" onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); action('click_position', { x: Math.round((e.clientX - rect.left)/rect.width * (screen.width || 1280)), y: Math.round((e.clientY - rect.top)/rect.height * (screen.height || 900)) }) }}/> : <div className="computer-loading"><Loader2 size={26} className="spin"/><p>正在连接云浏览器…</p></div>}{busy && <span className="computer-busy"><Loader2 className="spin" size={13}/>正在操作</span>}</div>
      </div><div className="desktop-dock"><button className="selected" aria-label="浏览器" onClick={() => setTab('computer')}><Globe size={25}/></button><button aria-label="打开文件" onClick={() => setTab('files')}><Folder size={25}/></button><button aria-label="键盘输入" onClick={() => setInspector(true)}><Keyboard size={25}/></button></div></div>
      <div className="computer-control-bar"><span>点击画面，直接操作</span><button className="primary" onClick={() => setInspector(true)}><Keyboard size={15}/>键盘输入</button></div>
      <div className="computer-status"><span>{screen.url === 'about:blank' ? '输入网址开始工作' : screen.url || '正在连接'}</span><div><button className="icon-button" aria-label="向上滚动" onClick={() => action('scroll', { y: -650 })}><ArrowUp size={17}/></button><button className="icon-button" aria-label="向下滚动" onClick={() => action('scroll', { y: 650 })}><ArrowDown size={17}/></button></div></div>
      <p className="surface-note"><ShieldCheck size={14}/>网站登录请你亲自完成。此浏览器不能访问 HK 宿主或其他项目内网。</p>
      {inspector && <Modal title="云浏览器键盘" onClose={() => { setInspector(false); setValue('') }} className="keyboard-sheet"><p className="surface-note">输入内容直接送到网页，不会写入对话。</p>
        <div className="form-field"><span>输入位置</span><Choice label="输入位置" value={selected === null ? '' : String(selected)} options={inputOptions} disabled={!inputOptions.length} placeholder={inputOptions.length ? '选择网页输入框' : '当前网页没有输入框'} onChange={value => setSelected(Number(value))}/></div>
        <label>输入内容<input type="password" aria-label="网页输入内容" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} placeholder="输入内容或密码"/></label>
        <div className="keyboard-actions"><button className="primary" disabled={selected === null || busy} onClick={() => { if (selected !== null) action('fill', { id: selected, value }).then(() => setValue('')) }}>填入网页</button><button className="secondary" disabled={busy} onClick={() => action('press', { key: 'Enter' })}>Enter</button><button className="secondary" disabled={busy} onClick={() => action('press', { key: 'Tab' })}>Tab</button></div>
      </Modal>}
    </> : <>
      <div className="file-breadcrumb"><button onClick={() => setFolder('')}><Folder size={16}/>工作区</button>{folder.split('/').filter(Boolean).map((part, index, parts) => <span key={index}><ChevronRight size={14}/><button onClick={() => setFolder(parts.slice(0,index+1).join('/'))}>{part}</button></span>)}</div>
      <div className="file-list">{files.length ? files.map(file => <button key={file.path} onClick={() => file.directory ? setFolder(file.path) : download(file.path, file.name).catch(e => onError(e.message))}><span className={`file-icon ${file.directory ? 'blue' : 'violet'}`}>{file.directory ? <Folder size={22}/> : <FileText size={22}/>}</span><span><strong>{file.name}</strong><small>{file.directory ? '文件夹' : `${(file.size/1024).toFixed(1)} KB`} · {new Date(file.updated*1000).toLocaleDateString('zh-CN')}</small></span>{file.directory ? <ChevronRight size={18}/> : <Download size={18}/>}</button>) : <div className="empty-state"><span className="empty-icon blue"><Folder size={30}/></span><h3>文件与成果都在这里。</h3><p>上传的资料、调研报告、代码与文档<br/>会保存在你的独立工作区。</p></div>}</div>
    </>}
  </section>
}
interface ReturnFile { name: string; path: string; directory: boolean; size: number; updated: number }
