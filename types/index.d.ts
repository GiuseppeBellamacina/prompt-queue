/** How a prompt typed while Claude is working is handled. */
export type Mode = 'steer' | 'queue' | 'interrupt'

/** A prompt held back until the running turn ends. */
export type Queued = { id: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'prompt-queue': {
      queue: Queued[]
      mode: Mode
      /** The main loop's running turn, null while idle. */
      running: string | null
      /** True after an interrupted or failed turn: the queue waits for a turn that ends normally, or "Send next". */
      held: boolean
      /** The prompt that interrupted the running turn, sent once that turn has ended. */
      now: string | null
    }
  }
}
