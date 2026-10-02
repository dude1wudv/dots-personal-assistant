import { useId, useMemo } from 'react'
import artwork from './mascot-live.svg?raw'

export type MascotState = 'idle' | 'thinking' | 'working' | 'waiting' | 'listening' | 'speaking' | 'offline'
const STATE_LABELS: Record<MascotState, string> = { idle: '待机', thinking: '正在思考', working: '正在工作', waiting: '等待授权', listening: '正在聆听', speaking: '正在说话', offline: '连接中断' }

export function Mascot({ className = '', state = 'idle' }: { className?: string; state?: MascotState }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  // Only the bundled, original artwork is injected; SVG IDs must not collide between avatars.
  const svg = useMemo(() => artwork.replace(/id="([^"]+)"/g, `id="mascot-${id}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#mascot-${id}-$1)`), [id])
  return <span className={`mascot mascot--${state} ${className}`} role="img" aria-label={`原创毛绒苔兔绒绒：${STATE_LABELS[state]}`} dangerouslySetInnerHTML={{ __html: svg }}/>
}
