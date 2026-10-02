import { z } from 'zod'

export const BotSchema = z.object({ id: z.string(), name: z.string(), role: z.string(), memory: z.string(), color: z.enum(['sage', 'blue', 'rose', 'violet', 'amber']), created: z.number() })
export type Bot = z.infer<typeof BotSchema>
export const BotTemplateSchema = z.object({ format: z.literal('dots-bot-v1'), bot: BotSchema.pick({ name: true, role: true, color: true }).strict() }).strict()
export const ConversationSchema = z.object({ id: z.string(), title: z.string(), model: z.string(), effort: z.string(), status: z.string(), updated: z.number(), bot_id: z.string().default('default'), members: z.array(z.object({ thread_id: z.string(), bot_id: z.string(), name: z.string(), status: z.string() })).optional() })
export type Conversation = z.infer<typeof ConversationSchema>
export const MeSchema = z.object({ session_id: z.string(), models: z.array(z.string()), default_effort: z.string(), profile: z.object({ name: z.string(), role: z.string() }), memory: z.string(), sessions: z.array(z.object({ id: z.string(), device: z.string(), created: z.number(), expires: z.number() })) })
export type Me = z.infer<typeof MeSchema>
export const LoginSchema = z.object({ token: z.string().min(32) })
export const AttachmentSchema = z.object({ path: z.string(), name: z.string() })
export const QuestionContentSchema = z.object({ question: z.string(), options: z.array(z.object({ label: z.string(), description: z.string().default('') })) })
export const QuestionSchema = z.object({ id: z.string(), thread_id: z.string(), turn_id: z.string(), payload: QuestionContentSchema, status: z.string(), created: z.number(), expires: z.number() })
export type Question = z.infer<typeof QuestionSchema>
export type QuestionContent = z.infer<typeof QuestionContentSchema>
export const RunSchema = z.object({ id: z.string(), kind: z.string(), bot_id: z.string().nullable(), thread_id: z.string().nullable(), parent_id: z.string().nullable(), group_id: z.string().nullable(), routine_id: z.string().nullable(), title: z.string(), model: z.string(), effort: z.string(), turn_id: z.string().nullable(), status: z.string(), created: z.number(), started: z.number().nullable().optional(), ended: z.number().nullable().optional(), updated: z.number(), failure_stage: z.string().nullable().optional(), error: z.string().nullable().optional(), stop_requested: z.number().nullable().optional() })
export type Run = z.infer<typeof RunSchema>
export const CodexItemSchema = z.looseObject({
  id: z.string(), type: z.string(), text: z.string().optional(), command: z.string().optional(),
  status: z.string().optional(), aggregatedOutput: z.string().nullable().optional(),
  tool: z.string().optional(), query: z.string().optional(), error: z.unknown().optional(),
  summary: z.array(z.string()).optional(),
  changes: z.array(z.object({ path: z.string(), diff: z.string().optional() })).optional(),
})
export const EventPayloadSchema = z.looseObject({
  text: z.string().optional(), itemId: z.string().optional(), delta: z.string().optional(),
  summaryIndex: z.number().int().nonnegative().optional(), steering: z.boolean().optional(),
  item: CodexItemSchema.optional(), attachments: z.array(z.string()).optional(),
  turn: z.looseObject({ id: z.string().optional(), status: z.string().optional(), error: z.object({ message: z.string().optional() }).nullable().optional() }).optional(),
  title: z.string().optional(),
  speaker: z.object({ id: z.string(), name: z.string(), color: z.string() }).optional(),
  client_id: z.string().nullable().optional(),
  question_id: z.string().optional(), question: z.string().optional(),
  options: QuestionContentSchema.shape.options.optional(),
  status: z.string().optional(), option: z.number().nullable().optional(),
})
export const DotEventSchema = z.object({ id: z.number(), thread_id: z.string().nullable(), kind: z.string(), payload: EventPayloadSchema, created: z.number() })
export type DotEvent = z.infer<typeof DotEventSchema>
export type CodexItem = z.infer<typeof CodexItemSchema>
export const ApprovalPayloadSchema = z.looseObject({
  reason: z.string().nullable().optional(), message: z.string().optional(), note: z.string().optional(), title: z.string().optional(),
  command: z.union([z.string(), z.array(z.string())]).transform(c => Array.isArray(c) ? c.join(' ') : c).nullable().optional(),
  changes: z.array(z.object({ path: z.string(), diff: z.string().optional() })).optional(),
  action: z.string().optional(), arguments: z.unknown().optional(), prompt: z.string().optional(), cron: z.string().optional(), timezone: z.string().optional(), url: z.string().optional(),
  questions: z.array(z.object({ id: z.string(), question: z.string().optional(), header: z.string().optional(), options: z.array(z.object({ label: z.string(), description: z.string().optional() })).optional() })).optional(),
  requestedSchema: z.object({ properties: z.record(z.string(), z.looseObject({ title: z.string().optional() })) }).optional(),
})
export const ApprovalSchema = z.object({ id: z.string(), thread_id: z.string().nullable(), kind: z.string(), code: z.string(), payload: ApprovalPayloadSchema, created: z.number() })
export type Approval = z.infer<typeof ApprovalSchema>
export const FileListSchema = z.object({ path: z.string(), items: z.array(z.object({ name: z.string(), path: z.string(), directory: z.boolean(), size: z.number(), updated: z.number() })) })
export const BrowserSchema = z.object({
  image: z.string().optional(), url: z.string().optional(), width: z.number().optional(), height: z.number().optional(), title: z.string().optional(), text: z.string().optional(), error: z.string().optional(),
  elements: z.array(z.object({ id: z.number(), tag: z.string(), type: z.string().nullable(), label: z.string(), href: z.string().nullable() })).optional(),
})
export type BrowserState = z.infer<typeof BrowserSchema>
export const RoutineSchema = z.object({ id: z.string(), title: z.string(), prompt: z.string(), cron: z.string(), timezone: z.string(), model: z.string(), enabled: z.number(), next_run: z.number(), thread_id: z.string().nullable(), last_error: z.string().nullable() })
export type Routine = z.infer<typeof RoutineSchema>
export const ConnectorSchema = z.object({ data: z.array(z.looseObject({ name: z.string(), tools: z.record(z.string(), z.unknown()).optional(), authStatus: z.string().optional() })) })
export const SkillsSchema = z.object({ data: z.array(z.looseObject({ skills: z.array(z.looseObject({ name: z.string(), description: z.string(), path: z.string().optional() })) })) })
export type Answers = Record<string, string | string[]>
