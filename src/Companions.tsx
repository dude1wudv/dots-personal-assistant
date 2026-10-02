import { useRef, useState } from 'react'
import { Check, ChevronRight, Download, FileInput, Menu, MoreHorizontal, Pencil, Plus, Search, Share2, Users } from 'lucide-react'
import { z } from 'zod'
import { api, isNative, native, post } from './api'
import { BotSchema, BotTemplateSchema, ConversationSchema, type Bot, type Conversation } from './protocol'
import { Modal } from './Controls'
import { Mascot } from './Mascot'

const COLORS: { value: Bot['color']; label: string }[] = [{ value: 'sage', label: '苔绿' }, { value: 'blue', label: '雾蓝' }, { value: 'rose', label: '蔷薇' }, { value: 'violet', label: '浅紫' }, { value: 'amber', label: '暖杏' }]
const HOME_STATUS: Record<string, string> = { waiting: '等待你的授权', running: '正在工作', failed: '任务遇到问题', interrupted: '任务已中断' }
export function BotAvatar({ color = 'sage' }: { color?: string }) {
  return <span className={`bot-avatar tone-${color}`}><Mascot/></span>
}

export function Companions({ bots, conversations, onRefresh, onChat, onGroup, onOpen, onNavigation, onError, initialBot }: { bots: Bot[]; conversations: Conversation[]; onRefresh: () => Promise<void>; onChat: (bot: Bot) => void; onGroup: (group: Conversation) => void; onOpen: (conversation: Conversation) => void; onNavigation: () => void; onError: (message: string) => void; initialBot?: Bot }) {
  const [editing, setEditing] = useState<Bot | 'new' | null>(initialBot || null)
  const [name, setName] = useState(initialBot?.name || ''), [role, setRole] = useState(initialBot?.role || '你的私人工作伙伴'), [memory, setMemory] = useState(initialBot?.memory || ''), [color, setColor] = useState<Bot['color']>(initialBot?.color || 'sage')
  const [grouping, setGrouping] = useState(false), [members, setMembers] = useState<string[]>([]), [title, setTitle] = useState(''), [query, setQuery] = useState('')
  const [template, setTemplate] = useState<string | null>(null), [importing, setImporting] = useState(false), [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false), [searching, setSearching] = useState(false), [actions, setActions] = useState<Bot | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const visible = bots.filter(b => b.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const groups = conversations.filter(c => c.members && c.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  function edit(bot: Bot | 'new') { setEditing(bot); setName(bot === 'new' ? '' : bot.name); setRole(bot === 'new' ? '你的私人工作伙伴' : bot.role); setMemory(bot === 'new' ? '' : bot.memory); setColor(bot === 'new' ? 'sage' : bot.color) }
  async function save() {
    setBusy(true)
    try {
      if (editing === 'new') await post('/api/bots', { name: name.trim(), role: role.trim(), color }, BotSchema)
      else if (editing) await api('/api/bots/' + editing.id, BotSchema, { method: 'PATCH', body: JSON.stringify({ name: name.trim(), role: role.trim(), color, memory }) })
      await onRefresh(); setEditing(null)
    } catch (e) { onError((e as Error).message) } finally { setBusy(false) }
  }
  async function createGroup() {
    setBusy(true)
    try { const group = await post('/api/groups', { title: title.trim(), bot_ids: members }, ConversationSchema); setGrouping(false); onGroup(group) }
    catch (e) { onError((e as Error).message) } finally { setBusy(false) }
  }
  async function preview(bot: Bot) {
    try { setTemplate(JSON.stringify(await api(`/api/bots/${bot.id}/template`, BotTemplateSchema), null, 2)); setImporting(false) }
    catch (e) { onError((e as Error).message) }
  }
  async function transfer() {
    setBusy(true)
    try {
      const value = BotTemplateSchema.parse(JSON.parse(template || ''))
      if (importing) { await post('/api/bot-templates/import', value, BotSchema); await onRefresh(); setTemplate(null) }
      else {
        const data = JSON.stringify(value, null, 2), filename = 'dots-bot-template.json'
        if (isNative) {
          const bytes = new TextEncoder().encode(data)
          await native.saveFile({ name: filename, data: btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')), mime: 'application/json' })
        } else {
          const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
          const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
        }
        setTemplate(null)
      }
    } catch (e) { onError(e instanceof z.ZodError || e instanceof SyntaxError ? '模板格式无效，只接受名称、指令和配色' : (e as Error).message) } finally { setBusy(false) }
  }
  return <section className="companions-home">
    <header className="home-topbar">
      <button className="icon-button home-circle" aria-label="打开导航" onClick={onNavigation}><Menu size={22}/></button>
      <span className="home-title">绒点</span>
      <button className="icon-button home-circle" aria-label="搜索伙伴与群聊" aria-expanded={searching} onClick={() => { setSearching(!searching); setQuery('') }}><Search size={22}/></button>
      <button className="icon-button home-circle" aria-label="创建伙伴或群聊" aria-haspopup="dialog" aria-expanded={creating} onClick={() => setCreating(true)}><Plus size={26}/></button>
    </header>
    <div className="companions-page page-scroll">
      {searching ? <div className="search-box"><Search size={18}/><input autoFocus aria-label="搜索伙伴与群聊" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索伙伴与群聊"/></div> : <div className="home-welcome"><Mascot/><h1>你的伙伴们</h1><p>选一位继续，或一起开始新的事情</p></div>}
      <div className="bot-list">
        {groups.map(group => <button className="bot-chat group-chat" key={group.id} onClick={() => onOpen(group)}><span className="home-group-avatar"><Users size={29}/></span><span><strong>{group.title}</strong><small>{HOME_STATUS[group.status] || group.members!.map(m => m.name).join('、')}</small></span><ChevronRight size={18}/></button>)}
        {visible.map(bot => { const latest = conversations.find(c => !c.members && c.bot_id === bot.id); return <article className="bot-card" key={bot.id}>
          <button className="bot-chat" onClick={() => latest ? onOpen(latest) : onChat(bot)}><BotAvatar color={bot.color}/><span><strong>{bot.name}</strong><small>{HOME_STATUS[latest?.status || ''] || latest?.title || bot.role}</small></span></button>
          <button className="icon-button bot-more" aria-label={`${bot.name}的选项`} onClick={() => setActions(bot)}><MoreHorizontal size={20}/></button>
        </article> })}
      </div>
      {!visible.length && !groups.length && <p className="search-empty">{query ? '没有找到伙伴或群聊' : '点右上角 ＋，创建第一位伙伴'}</p>}
      <p className="companion-note">私有伙伴 · 独立记忆 · 关键动作先授权</p>
    </div>
    {creating && <Modal title="创建" className="home-create-menu" onClose={() => setCreating(false)}><div className="home-menu-options">
      <button onClick={() => { setCreating(false); edit('new') }}><Plus size={21}/>新建 Bot</button>
      <button onClick={() => { setCreating(false); setGrouping(true); setMembers([]); setTitle(''); setQuery('') }}><Users size={21}/>新建群聊</button>
      <button onClick={() => { setCreating(false); setImporting(true); setTemplate('') }}><FileInput size={21}/>导入模板</button>
    </div></Modal>}
    {actions && <Modal title={actions.name} onClose={() => setActions(null)}><div className="home-menu-options">
      <button onClick={() => { onChat(actions); setActions(null) }}><Plus size={20}/>开始新对话</button>
      <button onClick={() => { edit(actions); setActions(null) }}><Pencil size={20}/>指令与记忆</button>
      <button onClick={() => { preview(actions); setActions(null) }}><Share2 size={20}/>导出模板</button>
    </div></Modal>}
    {editing && <Modal title={editing === 'new' ? '创建新 Bot' : '伙伴设置'} onClose={() => { if (!busy) setEditing(null) }} className="bot-editor">
      <div className="bot-preview"><BotAvatar color={color}/></div>
      <label>名字<input aria-label="Bot 名字" maxLength={30} value={name} onChange={e => setName(e.target.value)} placeholder="为伙伴取个名字"/></label>
      <div className="bot-colors" aria-label="伙伴配色">{COLORS.map(c => <button key={c.value} className={`tone-${c.value} ${color === c.value ? 'selected' : ''}`} aria-label={c.label} aria-pressed={color === c.value} onClick={() => setColor(c.value)}>{color === c.value && <Check size={20}/>}</button>)}</div>
      <label>工作指令<textarea aria-label="Bot 工作指令" rows={3} maxLength={2000} value={role} onChange={e => setRole(e.target.value)}/></label>
      {editing !== 'new' && <label>长期记忆<textarea aria-label="Bot 长期记忆" rows={3} maxLength={12000} value={memory} onChange={e => setMemory(e.target.value)}/></label>}
      <p className="companion-note">只影响这个伙伴，不会获得额外工具权限。新指令用于新对话及已保存对话的下一轮。</p>
      <button className="primary full-width" disabled={busy || !name.trim() || !role.trim()} onClick={save}>{busy ? '保存中…' : editing === 'new' ? '创建' : '保存'}</button>
    </Modal>}
    {grouping && <Modal title="新建群聊" onClose={() => { if (!busy) setGrouping(false) }} className="group-editor">
      <label>群聊名称<input aria-label="群聊名称" maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：项目小组"/></label>
      <div className="search-box"><Search size={17}/><input aria-label="搜索群聊成员" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索伙伴"/></div>
      <p className="companion-note">选择 2–4 位伙伴 · 已选 {members.length} 位</p>
      <div className="member-choices">{visible.map(bot => <button key={bot.id} aria-pressed={members.includes(bot.id)} disabled={!members.includes(bot.id) && members.length === 4} onClick={() => setMembers(list => list.includes(bot.id) ? list.filter(id => id !== bot.id) : [...list, bot.id])}><BotAvatar color={bot.color}/><span>{bot.name}</span>{members.includes(bot.id) && <Check size={19}/>}</button>)}</div>
      <button className="primary full-width" disabled={busy || !title.trim() || members.length < 2} onClick={createGroup}>{busy ? '创建中…' : '创建群聊'}</button>
    </Modal>}
    {template !== null && <Modal title={importing ? '导入 Bot 模板' : '分享为模板'} onClose={() => { if (!busy) setTemplate(null) }} className="template-sheet">
      <div className="template-warning"><Share2 size={22}/><span><strong>{importing ? '预览后创建新伙伴' : '先检查，再保存文件'}</strong><small>仅包含名字、工作指令和配色。不会包含聊天、记忆、任务、文件、账号或权限；不会发布到公网。请自行移除指令中可能含有的私人内容。</small></span></div>
      {importing && <button className="secondary" onClick={() => file.current?.click()}><FileInput size={16}/>选择模板文件</button>}
      <textarea className="template-json" aria-label="Bot 模板 JSON" rows={10} maxLength={12000} value={template} onChange={e => setTemplate(e.target.value)} placeholder="粘贴 dots-bot-v1 模板 JSON"/>
      <button className="primary full-width" disabled={busy || !template.trim()} onClick={transfer}>{importing ? <Plus size={17}/> : <Download size={17}/>} {busy ? '处理中…' : importing ? '导入为新伙伴' : '确认并保存模板'}</button>
    </Modal>}
    <input ref={file} type="file" accept="application/json,.json" hidden onChange={async e => { const selected = e.target.files?.[0]; e.target.value = ''; if (!selected) return; if (selected.size > 12000) { onError('模板文件最大12KB'); return } try { setTemplate(await selected.text()) } catch { onError('无法读取模板文件') } }}/>
  </section>
}
