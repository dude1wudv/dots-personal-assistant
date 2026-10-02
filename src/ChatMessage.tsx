import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText, Paperclip } from 'lucide-react'
import { download } from './api'
import type { ChatItem } from './events'
import { paragraphChunks } from './messages'

function useRevealedText(text: string, animate: boolean, onGrowth?: () => void) {
  const [shown, setShown] = useState(animate ? '' : text)
  const displayed = useRef(shown), frame = useRef(0), grow = useRef(onGrowth)
  grow.current = onGrowth
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const finish = () => { cancelAnimationFrame(frame.current); displayed.current = text; setShown(text); grow.current?.() }
    if (!animate || preference.matches || document.hidden || !text.startsWith(displayed.current)) { finish(); return }
    const start = displayed.current.length, length = text.length - start
    const duration = Math.min(1200, Math.max(120, length * 5)), began = performance.now()
    const step = (now: number) => {
      const count = Math.min(text.length, start + Math.ceil(length * Math.min(1, (now - began) / duration)))
      displayed.current = text.slice(0, count); setShown(displayed.current); grow.current?.()
      if (count < text.length) frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
    const changed = () => { if (document.hidden || preference.matches) finish() }
    document.addEventListener('visibilitychange', changed); preference.addEventListener('change', changed)
    return () => { cancelAnimationFrame(frame.current); document.removeEventListener('visibilitychange', changed); preference.removeEventListener('change', changed) }
  }, [text, animate])
  return shown
}

export function ChatMessage({ item, onError, animate = false, onGrowth }: { item: ChatItem; onError: (text: string) => void; animate?: boolean; onGrowth?: () => void }) {
  const assistant = item.role === 'assistant'
  const shown = useRevealedText(item.text, assistant && animate, onGrowth)
  return <article className={`chat-message ${item.role}`}><div className={`message-content ${assistant ? 'reply-blocks' : ''}`} aria-busy={shown !== item.text}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url => url.startsWith('/workspace/') ? url : /^(https?:|mailto:)/.test(url) ? url : ''} components={{
      p: ({ children }) => assistant && typeof children === 'string' ? <>{paragraphChunks(children).map((part, index) => <p key={index}>{part}</p>)}</> : <p>{children}</p>,
      a: ({ href, children }) => href?.startsWith('/workspace/') ? <button className="file-link" onClick={() => download(href.slice(11).split(':')[0], href.split('/').pop()?.split(':')[0] || '文件').catch(e => onError(e.message))}><FileText size={14}/>{children}</button> : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
    }}>{shown}</ReactMarkdown>
    {item.data?.attachments?.map(path => <button key={path} className="attachment-chip" onClick={() => download(path, path.split('/').pop() || '附件').catch(e => onError(e.message))}><Paperclip size={14}/>{path.split('/').pop()}</button>)}
  </div></article>
}
