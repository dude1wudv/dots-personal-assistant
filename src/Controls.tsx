import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, X } from 'lucide-react'

const modalStack: HTMLDialogElement[] = []
const modalListeners = new Set<() => void>()
const subscribeToModals = (notify: () => void) => { modalListeners.add(notify); return () => { modalListeners.delete(notify) } }
const activeModal = () => modalStack[modalStack.length - 1] || document.body
const notifyModalChange = () => { modalListeners.forEach(notify => notify()) }

export function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  const titleId = useId()
  close.current = onClose
  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement as HTMLElement | null
    element.showModal()
    modalStack.push(element)
    notifyModalChange()
    const dismiss = (event: Event) => {
      if (modalStack[modalStack.length - 1] !== element) return
      event.preventDefault()
      event.stopImmediatePropagation()
      close.current()
    }
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || modalStack[modalStack.length - 1] !== element) return
      const focusable = [...element.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, [tabindex]')].filter(item => item.tabIndex >= 0 && !item.matches(':disabled') && item.getClientRects().length > 0)
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (!first) { event.preventDefault(); element.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    element.addEventListener('keydown', trapFocus)
    window.addEventListener('dots-dismiss-overlay', dismiss)
    return () => {
      window.removeEventListener('dots-dismiss-overlay', dismiss)
      element.removeEventListener('keydown', trapFocus)
      const index = modalStack.indexOf(element)
      if (index !== -1) modalStack.splice(index, 1)
      element.close()
      notifyModalChange()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return createPortal(<dialog ref={dialog} className={`sheet ${className}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }} onClick={event => {
    if (event.target !== event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
  }}>
    <div className="sheet-handle" />
    <header className="sheet-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label={`关闭${title}`} onClick={onClose}><X size={20}/></button></header>
    {children}
  </dialog>, document.body)
}

export function Notice({ message, onClose }: { message: string; onClose: () => void }) {
  const target = useSyncExternalStore(subscribeToModals, activeModal)
  return createPortal(<div className="toast" role="status">{message}<button type="button" aria-label="关闭提示" onClick={onClose}><X size={17}/></button></div>, target)
}

export interface ChoiceOption { value: string; label: string; description?: string; icon?: ReactNode }
export function Choice({ label, value, options, onChange, placeholder = '请选择', compact = false, disabled = false }: { label: string; value: string; options: ChoiceOption[]; onChange: (value: string) => void; placeholder?: string; compact?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const option = options.find(item => item.value === value)
  return <>
    <button type="button" className={`choice-trigger ${compact ? 'compact' : ''}`} aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
      {option?.icon}<span>{option?.label || placeholder}</span><ChevronDown size={15}/>
    </button>
    {open && <Modal title={label} onClose={() => setOpen(false)} className="choice-sheet">
      <div className="choice-list" role="radiogroup" aria-label={label} onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
      }}>
        {options.map((item, index) => <button key={item.value} type="button" role="radio" aria-checked={value === item.value} autoFocus={value === item.value || (!option && index === 0)} className={`choice-option ${value === item.value ? 'selected' : ''}`} onClick={() => { onChange(item.value); setOpen(false) }}>
          {item.icon && <span className="choice-icon">{item.icon}</span>}<span><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span>{value === item.value && <Check size={18}/>}
        </button>)}
      </div>
    </Modal>}
  </>
}

export function ConfirmDialog({ title, description, confirmLabel, busy, onCancel, onConfirm }: { title: string; description: string; confirmLabel: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <Modal title={title} onClose={() => { if (!busy) onCancel() }} className="confirm-sheet"><p className="confirm-description">{description}</p><footer className="sheet-actions"><button type="button" className="secondary" disabled={busy} onClick={onCancel}>取消</button><button type="button" className="primary danger" disabled={busy} onClick={onConfirm}>{busy ? '正在处理…' : confirmLabel}</button></footer></Modal>
}
