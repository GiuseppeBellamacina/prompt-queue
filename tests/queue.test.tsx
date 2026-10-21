import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'prompt-queue',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

// The engine beneath the plugin: records what reaches the session.
function engine(on: On, store: Record<string, unknown> = {}) {
  const seen = { sent: [] as string[], aborted: [] as string[] }
  mock.store(on, store)
  mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.abort', (_, e) => (seen.aborted.push(e.turnId), { value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => (seen.sent.push(e.text), { text: e.text }))
  return seen
}

const typed = (text: string, wait = false) => ({ text, turnId: 't1', wait, origin: { kind: 'composer' as const } })

test('steer (the default) lets a mid-turn prompt through', async ($, on) => {
  const seen = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'task', turnId: 't1' })

  const r = await $.prompt.submit(typed('also check the tests'))
  expect(r.drop).toBeUndefined()
  expect(seen.sent).toEqual(['also check the tests'])
})

test('queue holds prompts, the band reorders them, the end of the turn sends the first', async ($, on) => {
  const seen = engine(on, { mode: 'queue' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'task', turnId: 't1' })

  expect((await $.prompt.submit(typed('first'))).drop).toMatch(/#1/)
  expect((await $.prompt.submit(typed('second'))).drop).toMatch(/#2/)
  expect(seen.sent).toEqual([])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /2 queued/ })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const [down] = await ui.findAll({ type: 'Button', text: '↓' })
  await ui.press({ key: down!.key! })
  await ui.unmount()

  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(seen.sent).toEqual(['second'])
})

test('ctrl+x enter queues even in steer mode, and cancel removes one', async ($, on) => {
  const seen = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'task', turnId: 't1' })

  await $.prompt.submit(typed('keep', true))
  await $.prompt.submit(typed('drop me', true))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const [, second] = await ui.findAll({ type: 'Button', text: '✕' })
  await ui.press({ key: second!.key! })
  await ui.unmount()

  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(seen.sent).toEqual(['keep'])
})

test('interrupt stops the running turn, sends the new prompt, and the queue waits for it', async ($, on) => {
  const seen = engine(on, { mode: 'interrupt' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'task', turnId: 't1' })
  await $.prompt.submit(typed('afterwards', true))

  expect((await $.prompt.submit(typed('stop, do this instead'))).drop).toMatch(/Interrupted/)
  expect(seen.aborted).toEqual(['t1'])
  expect(seen.sent).toEqual([])

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  expect(seen.sent).toEqual(['stop, do this instead'])

  await $.turn.start({ text: 'stop, do this instead', turnId: 't2' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  expect(seen.sent).toEqual(['stop, do this instead', 'afterwards'])
})

test('/now while idle puts the text back in the box, /queue while working queues, /now while working interrupts', async ($, on) => {
  const seen = engine(on)
  const box: string[] = []
  on('prompt.fill', (_, e) => (box.push(e.text), { isFilled: true }))
  const run = (command: string, args: string) =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await run('now', 'hello')
  expect(box).toEqual(['hello'])
  expect(seen.sent).toEqual([])

  await $.turn.start({ text: 'hello', turnId: 't1' })
  await run('queue', 'next one')
  await run('now', 'urgent')
  expect(seen.aborted).toEqual(['t1'])
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  expect(seen.sent).toEqual(['urgent'])

  await $.turn.start({ text: 'urgent', turnId: 't2' })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  expect(seen.sent).toEqual(['urgent', 'next one'])
})

test('an interrupted turn holds the queue until "Send next"', async ($, on) => {
  const seen = engine(on, { mode: 'queue' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
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

test('the mode buttons switch the mode', async ($, on) => {
  const seen = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'task', turnId: 't1' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'mode-queue' })
  await ui.unmount()
  expect((await $.prompt.submit(typed('held back'))).drop).toMatch(/Queued/)
  expect(seen.sent).toEqual([])
})

test('the band stays out of the way while idle with an empty queue', async ($, on) => {
  engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, isWorking: false } })
  expect(await ui.find({ type: 'Button', text: 'Queue' })).toBeUndefined()
  await ui.unmount()
})
