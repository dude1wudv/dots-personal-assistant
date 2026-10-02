import { useEffect, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, Menu, Monitor, Smartphone, Sparkles, Trash2 } from 'lucide-react'
import { z } from 'zod'
import { api, isNative, native } from './api'
import { ConfirmDialog, Modal } from './Controls'
import { ConnectorSchema, MeSchema, SkillsSchema, type Me } from './protocol'
import { version } from '../package.json'

type Field = 'name' | 'role' | 'memory'
const FIELD_TITLES: Record<Field, string> = { name: '名字', role: '工作方式', memory: '长期记忆' }

export function Profile({ me, onUpdate, onError, onLogout, onBack, onNavigation, showWorkStatus, onWorkStatusChange }: {
  me: Me | null; onUpdate: (me: Me) => void; onError: (text: string) => void; onLogout: () => Promise<void>
  onBack: () => void; onNavigation: () => void; showWorkStatus: boolean; onWorkStatusChange: (enabled: boolean) => void
}) {
  const [section, setSection] = useState<'main' | 'devices' | 'tools'>('main')
  const [editing, setEditing] = useState<Field | null>(null), [draft, setDraft] = useState(''), [saving, setSaving] = useState(false)
  const [background, setBackground] = useState(localStorage.getItem('dots-background') === 'true')
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]), [connectors, setConnectors] = useState<string[]>([])
  const [revoking, setRevoking] = useState<string | null>(null), [busy, setBusy] = useState(false), [logout, setLogout] = useState(false)
  useEffect(() => {
    api('/api/skills', SkillsSchema).then(data => setSkills(data.data.flatMap(group => group.skills))).catch(e => onError(e.message))
    api('/api/connectors', ConnectorSchema).then(data => setConnectors(data.data.map(server => server.name))).catch(e => onError(e.message))
  }, [onError])
  useEffect(() => {
    if (section === 'main') return
    const back = (event: Event) => {
      if (document.querySelector('dialog[open]')) return
      event.preventDefault(); event.stopImmediatePropagation(); setSection('main')
    }
    window.addEventListener('dots-dismiss-overlay', back)
    return () => window.removeEventListener('dots-dismiss-overlay', back)
  }, [section])
  function edit(field: Field) {
    setDraft(field === 'memory' ? me?.memory || '' : me?.profile[field] || '')
    setEditing(field)
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!editing || saving) return
    setSaving(true)
    try {
      const latest = await api('/api/me', MeSchema)
      const value = { ...latest.profile, memory: latest.memory, [editing]: draft }
      await api('/api/profile', z.unknown(), { method: 'PATCH', body: JSON.stringify(value) })
      onUpdate(await api('/api/me', MeSchema)); setEditing(null)
    } catch (e) { onError(e instanceof Error ? e.message : '设置保存失败') } finally { setSaving(false) }
  }
  async function revoke() {
    if (!revoking) return
    setBusy(true)
    try { await api('/api/sessions/' + revoking, z.unknown(), { method: 'DELETE' }); onUpdate(await api('/api/me', MeSchema)); setRevoking(null) } catch (e) { onError(e instanceof Error ? e.message : '设备退出失败') } finally { setBusy(false) }
  }
  async function toggleBackground() {
    setBusy(true)
    try { await native.background({ enabled: !background }); localStorage.setItem('dots-background', String(!background)); setBackground(!background) } catch (e) { onError(e instanceof Error ? e.message : '后台提醒设置失败') } finally { setBusy(false) }
  }
  return <section className="settings-screen">
    <header className="page-topbar settings-topbar"><button className="icon-button" aria-label={section === 'main' ? '返回对话' : '返回设置'} onClick={() => section === 'main' ? onBack() : setSection('main')}><ArrowLeft size={22}/></button><span>{section === 'devices' ? '设备与通知' : section === 'tools' ? '工具与技能' : '设置'}</span><button className="icon-button" aria-label="打开导航" onClick={onNavigation}><Menu size={22}/></button></header>
    <div className="page-scroll profile-page">
      {section === 'main' && <>
        <h2 className="settings-label">绒绒</h2>
        <div className="settings-group">
          {(['name', 'role', 'memory'] as const).map(field => <button key={field} className="settings-row" disabled={!me} onClick={() => edit(field)}><span>{FIELD_TITLES[field]}</span><small>{field === 'memory' ? me?.memory ? '已保存' : '未添加' : me?.profile[field]}</small><ChevronRight size={18}/></button>)}
        </div>
        <h2 className="settings-label">应用</h2>
        <div className="settings-group">
          <button className="settings-row" onClick={() => setSection('devices')}><Smartphone size={19}/><span>设备与通知</span><ChevronRight size={18}/></button>
          <button className="settings-row" onClick={() => setSection('tools')}><Sparkles size={19}/><span>工具与技能</span><ChevronRight size={18}/></button>
        </div>
        <div className="settings-group"><div className="settings-row setting-switch"><span><strong>工作状态</strong><small>在绒绒下方显示当前进度。</small></span><button className={`toggle ${showWorkStatus ? 'on' : ''}`} role="switch" aria-label="工作状态" aria-checked={showWorkStatus} onClick={() => onWorkStatusChange(!showWorkStatus)}><span/></button></div></div>
        <div className="settings-group"><button className="settings-row logout-button" onClick={() => setLogout(true)}>退出登录</button></div>
        <footer className="profile-footer">绒点 {version}</footer>
      </>}
      {section === 'devices' && <>
        <h2 className="settings-label">已登录设备</h2>
        <div className="settings-group">{me?.sessions.map(session => <div className="settings-row device-row" key={session.id}>{session.device.includes('Android') ? <Smartphone size={20}/> : <Monitor size={20}/>}<span><strong>{session.device}</strong><small>{session.id === me.session_id ? '当前设备 · ' : ''}{new Date(session.created*1000).toLocaleString('zh-CN')}</small></span>{session.id !== me.session_id && <button className="icon-button" aria-label={`退出${session.device}`} onClick={() => setRevoking(session.id)}><Trash2 size={17}/></button>}</div>)}</div>
        <div className="settings-group"><div className="settings-row setting-switch"><span><strong>后台任务提醒</strong><small>{isNative ? '任务完成或需要授权时通知你。' : '在 Android 应用中开启。'}</small></span><button className={`toggle ${background ? 'on' : ''}`} role="switch" disabled={!isNative || busy} aria-label="后台任务提醒" aria-checked={background} onClick={toggleBackground}><span/></button></div></div>
        <p className="settings-note">关闭应用不会停止云端任务。手机省电设置可能影响通知。</p>
      </>}
      {section === 'tools' && <>
        <h2 className="settings-label">已连接工具</h2>
        <div className="settings-group">{connectors.map(server => <div key={server} className="settings-row"><Monitor size={20}/><span>{server === 'dots_computer' ? '云端工作空间' : server}</span><Check size={17}/></div>)}</div>
        <p className="settings-note">网站账号与验证码请在云浏览器中亲自输入。</p>
        <h2 className="settings-label">技能</h2>
        {skills.length ? <div className="settings-group">{skills.map(skill => <details className="skill-row" key={skill.name}><summary><strong>{skill.name}</strong><ChevronRight size={17}/></summary><p>{skill.description}</p></details>)}</div> : <p className="settings-note">暂无技能。可在对话中让绒绒保存可复用的工作流程。</p>}
      </>}
    </div>
    {editing && <Modal title={FIELD_TITLES[editing]} className="settings-editor" onClose={() => { if (!saving) setEditing(null) }}>
      <form onSubmit={save}>
        <label>{FIELD_TITLES[editing]}{editing === 'name' ? <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} maxLength={30} required/> : <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} rows={editing === 'memory' ? 7 : 5} maxLength={editing === 'memory' ? 12000 : 2000} required={editing === 'role'} placeholder={editing === 'memory' ? '记录背景、偏好或常用信息' : '希望绒绒如何工作'}/>}</label>
        {editing === 'memory' && <p className="settings-note">不要存入密码或密钥。</p>}
        <div className="sheet-actions"><button className="primary full-width" type="submit" disabled={saving}>{saving ? '正在保存…' : '保存'}</button></div>
      </form>
    </Modal>}
    {revoking && <ConfirmDialog title="退出这个设备？" description="该设备需要重新登录，已有任务与文件会保留。" confirmLabel="退出该设备" busy={busy} onCancel={() => setRevoking(null)} onConfirm={() => { void revoke() }}/>}
    {logout && <ConfirmDialog title="退出登录？" description="云端任务会继续运行。" confirmLabel="退出登录" busy={busy} onCancel={() => setLogout(false)} onConfirm={() => { setBusy(true); onLogout().catch(e => onError(e.message)).finally(() => setBusy(false)) }}/>}
  </section>
}
