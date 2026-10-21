import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mode, Queued } from '../types'

const queue = atom({ plugin: 'prompt-queue', key: 'queue' } as const, [])
const mode = atom({ plugin: 'prompt-queue', key: 'mode' } as const, 'steer')
const running = atom({ plugin: 'prompt-queue', key: 'running' } as const, null)
const held = atom({ plugin: 'prompt-queue', key: 'held' } as const, false)
const now = atom({ plugin: 'prompt-queue', key: 'now' } as const, null)

const MODES: readonly Mode[] = ['steer', 'queue', 'interrupt']
const LABELS: Record<Mode, string> = { steer: 'Steer', queue: 'Queue', interrupt: 'Interrupt' }
const isMode = (v: unknown): v is Mode => MODES.includes(v as Mode)

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

function move(list: readonly Queued[], id: string, by: number): Queued[] {
  const i = list.findIndex(q => q.id === id)
  const j = i + by
  if (i < 0 || j < 0 || j >= list.length) return [...list]
  const copy = [...list]
  ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  return copy
}

// asUser: the model reads it as the person's own words, not as a plugin's message.
const send = ($: EngineInterface, text: string) => void $.prompt.submit({ text, asUser: true })

async function enqueue($: EngineInterface, text: string): Promise<number> {
  const id = `${await $.clock.now()}-${Math.random().toString(36).slice(2, 8)}`
  return (await update($, queue, list => [...list, { id, text }])).length
}

async function sendNext($: EngineInterface) {
  let next: Queued | undefined
  await update($, queue, ([first, ...rest]) => ((next = first), rest))
  await update($, held, () => false)
  if (next) send($, next.text)
}

// Stops the running turn and keeps `text` for its turn.complete, the first point a prompt can be submitted;
// false when there was no turn to stop (it had just ended).
async function interrupt($: EngineInterface, turnId: string | null, text: string): Promise<boolean> {
  if (turnId === null) return false
  await update($, now, () => text)
  const stopped = await $.turn.abort({ turnId }).then(() => true, () => false)
  if (!stopped) await update($, now, () => null)
  return stopped
}

// A command hook cannot submit a prompt itself, so while Claude is idle the text goes back to the box for one Enter.
async function backToBox($: EngineInterface, text: string) {
  const { isFilled } = await $.prompt.fill({ text })
  $.ui.toast(isFilled ? 'Claude is idle: press Enter to send it.' : 'Claude is idle: send the message normally.')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('mode')
    if (isMode(saved)) await update($, mode, () => saved)
    await $.command.register({
      name: 'queue',
      description: 'Queue a message: Claude gets it only after the current task is finished',
      argumentHint: '<message>',
      immediate: true,
    })
    await $.command.register({
      name: 'now',
      description: 'Interrupt Claude and send this message right away',
      argumentHint: '<message>',
      immediate: true,
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, running, () => e.turnId)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await update($, running, () => null)
    const interrupting = await read($, now)
    if (interrupting !== null) {
      // The queue waits for the interrupting prompt's own turn to finish.
      await update($, now, () => null)
      send($, interrupting)
    } else if (e.reason === 'answer') await sendNext($)
    else if ((await read($, queue)).length > 0) await update($, held, () => true)
    return next(e)
  })

  // Only prompts the person types while a turn runs; slash commands and machine-made prompts pass untouched.
  on('prompt.submit', async ($, e, next) => {
    const typed = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (e.turnId === undefined || !typed || e.command !== undefined || e.isMeta) return next(e)

    const how: Mode = e.wait ? 'queue' : await read($, mode)
    if (how === 'steer') return next(e)
    if (e.attachments?.length) {
      // shortcut: a plugin cannot re-send images or files, so these stay with Claude Code's own handling.
      $.ui.toast('Message with attachments: left to Claude Code (prompt-queue cannot hold attachments).')
      return next(e)
    }
    if (how === 'queue') {
      const n = await enqueue($, e.text)
      return { drop: `Queued as #${n}: Claude gets it when the current task is finished.` }
    }
    if (!(await interrupt($, e.turnId, e.text))) return next(e)
    return { drop: 'Interrupted the running turn: this message is sent now.' }
  })

  on('command.run', { command: 'queue' }, async ($, e) => {
    const text = e.args.trim()
    if (text === '') $.ui.toast('Usage: /queue <message>')
    else if ((await read($, running)) === null) await backToBox($, text)
    else $.ui.toast(`Queued as #${await enqueue($, text)}.`)
    return {}
  })

  on('command.run', { command: 'now' }, async ($, e) => {
    const text = e.args.trim()
    if (text === '') $.ui.toast('Usage: /now <message>')
    else if (!(await interrupt($, await read($, running), text))) await backToBox($, text)
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const list = await read($, queue)
    if (!e.props.isWorking && list.length === 0) return next(e)
    // Other mods share this band: theirs is drawn below ours.
    const below = await next(e).catch(() => undefined)
    const current = await read($, mode)
    const isHeld = await read($, held)
    const { Box, Text, Button } = $.ui.resolve(e)

    const setMode = async (m: Mode) => {
      await update($, mode, () => m)
      await $.store.set('mode', m)
    }
    const edit = (fn: (l: Queued[]) => Queued[]) => update($, queue, l => fn([...l]))

    const mine = (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {/* Sets the band apart from other plugins' bands drawn next to it. */}
        <Text dimColor wrap="truncate-end">{`── prompt-queue ${'─'.repeat(e.props.bodyColumns)}`}</Text>
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text dimColor>Enter while working:</Text>
          {MODES.map(m => (
            <Button
              key={`mode-${m}`}
              label={LABELS[m]}
              {...(m === current ? { variant: 'primary' as const } : { plain: true as const, dimColor: true })}
              onPress={() => setMode(m)}
            />
          ))}
          {list.length > 0 && (
            <Text color={isHeld ? 'warning' : undefined}>
              · {list.length} queued{isHeld ? ', paused after an interruption' : ''}
            </Text>
          )}
          <Box flexGrow={1} />
          {list.length > 0 && !e.props.isWorking && <Button key="send-next" plain label="Send next" onPress={() => sendNext($)} />}
          {list.length > 0 && <Button key="clear" plain label="Clear" onPress={() => edit(() => [])} />}
        </Box>
        {list.map((q, i) => (
          <Box key={`row-${q.id}`} flexDirection="row" gap={1}>
            <Text dimColor>{i + 1}.</Text>
            <Box flexGrow={1}>
              <Text wrap="truncate-end">{oneLine(q.text)}</Text>
            </Box>
            <Button key={`up-${q.id}`} plain label="↑" onPress={() => edit(l => move(l, q.id, -1))} />
            <Button key={`down-${q.id}`} plain label="↓" onPress={() => edit(l => move(l, q.id, 1))} />
            <Button key={`drop-${q.id}`} plain label="✕" onPress={() => edit(l => l.filter(x => x.id !== q.id))} />
          </Box>
        ))}
      </Box>
    )
    return below ? (
      <Box flexDirection="column">
        {mine}
        {below}
      </Box>
    ) : (
      mine
    )
  })
}
