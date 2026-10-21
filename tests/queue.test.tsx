import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'prompt-queue',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

// The engine beneath the plugin: records what reaches the session.
function engine(on: On) {
  const seen = { sent: [] as string[], aborted: [] as string[], box: [] as string[] }
  mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.abort', (_, e) => (seen.aborted.push(e.turnId), { value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.fill', (_, e) => (seen.box.push(e.text), { isFilled: true }))
  on('prompt.submit', (_, e) => (seen.sent.push(e.text), { text: e.text }))
  return seen
}

const typed = (text: string, wait = false) => ({ text, turnId: 't1', wait, origin: { kind: 'composer' as const } })
const answered = (turnId: string) => ({ answer: 'done', durationMs: 1, isAborted: false, turnId, reason: 'answer' as const })

test('off by default: mid-turn prompts steer as usual and no band shows', async ($, on) => {
  const seen = engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'task', turnId: 't1' })

  expect((await $.prompt.submit(typed('also check the tests'))).drop).toBeUndefined()
  expect((await $.prompt.submit(typed('ctrl+x enter stays native', true))).drop).toBeUndefined()
  expect(seen.sent).toEqual(['also check the tests', 'ctrl+x enter stays native'])

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /prompt-queue/ })).toBeUndefined()
  await ui.unmount()
})

test('/queue on queues, the band reorders, the end of the turn sends the first', async ($, on) => {
  const seen = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'queue', args: 'on', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await $.turn.start({ text: 'task', turnId: 't1' })

  expect((await $.prompt.submit(typed('first'))).drop).toMatch(/#1/)
  expect((await $.prompt.submit(typed('second'))).drop).toMatch(/#2/)
  expect(seen.sent).toEqual([])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Queue on · 2 queued/ })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const [down] = await ui.findAll({ type: 'Button', text: '↓' })
  await ui.press({ key: down!.key! })
  const [, cancel] = await ui.findAll({ type: 'Button', text: '✕' })
  await ui.press({ key: cancel!.key! })
  await ui.unmount()

  await $.turn.complete(answered('t1'))
  expect(seen.sent).toEqual(['second'])
})

test('/queue <message> turns the queue on and adds the message, even while idle', async ($, on) => {
  const seen = engine(on)
  const run = (args: string) =>
    $.command.run({ command: 'queue', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await run('open a PR afterwards')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, isWorking: false } })
  expect(await ui.find({ type: 'Text', text: /open a PR afterwards/ })).toBeDefined()
  await ui.unmount()

  await $.turn.start({ text: 'task', turnId: 't1' })
  expect((await $.prompt.submit(typed('typed later'))).drop).toMatch(/#2/)
  await $.turn.complete(answered('t1'))
  expect(seen.sent).toEqual(['open a PR afterwards'])
})

test('/queue off goes back to steering; what was queued still goes out', async ($, on) => {
  const seen = engine(on)
  const run = (args: string) =>
    $.command.run({ command: 'queue', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'task', turnId: 't1' })
  await run('later')
  await run('off')

  expect((await $.prompt.submit(typed('steer now'))).drop).toBeUndefined()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Queue off · 1 left/ })).toBeDefined()
  await ui.unmount()

  await $.turn.complete(answered('t1'))
  expect(seen.sent).toEqual(['steer now', 'later'])
})

test('/now interrupts while working, and the queue waits for its turn; while idle it fills the box', async ($, on) => {
  const seen = engine(on)
  const run = (command: string, args: string) =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await run('now', 'hello')
  expect(seen.box).toEqual(['hello'])

  await $.turn.start({ text: 'hello', turnId: 't1' })
  await run('queue', 'next one')
  await run('now', 'urgent')
  expect(seen.aborted).toEqual(['t1'])
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  expect(seen.sent).toEqual(['urgent'])

  await $.turn.start({ text: 'urgent', turnId: 't2' })
  await $.turn.complete(answered('t2'))
  expect(seen.sent).toEqual(['urgent', 'next one'])
})

test('an interrupted turn holds the queue until "Send next"', async ($, on) => {
  const seen = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'queue', args: 'on', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await $.turn.start({ text: 'task', turnId: 't1' })
  await $.prompt.submit(typed('later'))

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  expect(seen.sent).toEqual([])

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, isWorking: false } })
  expect(await ui.find({ type: 'Text', text: /paused/ })).toBeDefined()
  await ui.press({ key: 'send-next' })
  await ui.unmount()
  expect(seen.sent).toEqual(['later'])
})
