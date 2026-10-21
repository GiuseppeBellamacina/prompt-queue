/** A prompt held back until the running turn ends. */
export type Queued = { id: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'prompt-queue': {
      queue: Queued[]
      /** `>> on`: prompts typed while Claude works are queued instead of steering it. */
      isOn: boolean
      /** The main loop's running turn, null while idle. */
      running: string | null
      /** True after an interrupted or failed turn: the queue waits for a turn that ends normally, or "Send next". */
      held: boolean
      /** The prompt that interrupted the running turn, sent once that turn has ended. */
      now: string | null
    }
  }
}
