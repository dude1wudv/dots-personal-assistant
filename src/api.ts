import { Capacitor, registerPlugin } from '@capacitor/core'
import { z } from 'zod'

interface DotNative {
  getToken(): Promise<{ token: string }>
  setToken(options: { token: string }): Promise<void>
  clearToken(): Promise<void>
  listen(): Promise<{ text: string }>
  speak(options: { text: string }): Promise<void>
  stopSpeaking(): Promise<void>
  hideKeyboard(): Promise<void>
  background(options: { enabled: boolean }): Promise<void>
  saveFile(options: { name: string; data: string; mime: string }): Promise<{ uri: string }>
}
export const native = registerPlugin<DotNative>('DotNative')
export const isNative = Capacitor.isNativePlatform()
export const base = isNative ? (import.meta.env.VITE_DOTS_API_ORIGIN || 'https://dots.example.com') : ''
let token = ''
export async function restoreToken() {
  token = isNative ? (await native.getToken()).token : (sessionStorage.getItem('dots-session') || '')
  return token
}
export async function saveToken(value: string) {
  token = value
  if (isNative) await native.setToken({ token: value })
  else sessionStorage.setItem('dots-session', value)
}
export async function clearToken() {
  token = ''
  if (isNative) await native.clearToken()
  else sessionStorage.removeItem('dots-session')
}
export async function request(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(base + path, { ...options, headers, signal: options.signal || AbortSignal.timeout(120000) })
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => ({}))
    if (response.status === 401 && path !== '/api/login') window.dispatchEvent(new Event('dots-unauthorized'))
    const detail = z.object({ detail: z.string() }).safeParse(data)
    throw new Error(detail.success ? detail.data.detail : `请求失败（${response.status}）`)
  }
  return response
}
export async function api<T>(path: string, schema: z.ZodType<T>, options: RequestInit = {}): Promise<T> {
  const response = await request(path, options)
  const data: unknown = await response.json()
  return schema.parse(data)
}
export function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>
export function post(path: string, body?: unknown): Promise<unknown>
export async function post(path: string, body: unknown = {}, schema: z.ZodType = z.unknown()) {
  return api(path, schema, { method: 'POST', body: JSON.stringify(body) })
}
export async function download(path: string, name: string) {
  const response = await request('/api/file?path=' + encodeURIComponent(path))
  const blob = await response.blob()
  if (isNative) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob)
    })
    await native.saveFile({ name, data, mime: blob.type || 'application/octet-stream' })
  } else {
    const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url)
  }
}
