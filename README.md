# prompt-queue — queue messages for after Claude's current task, or interrupt it

> `/queue on` and what you send while Claude works waits until the task is finished, in a queue above the prompt you can reorder, cancel or clear. `/now <message>` stops the task and sends the message at once. `/queue off` and everything is back to normal.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757.svg)](https://code.claude.com/docs/en/plugins)

In Claude Code, a message you send while Claude is working reaches it as soon as it has a moment: it **steers** the task in progress. That is often what you want, but not always:

- you thought of the **next** task, and do not want Claude to start mixing it into the current one;
- the current task went the wrong way, and you want it **stopped** in favour of the new message.

`prompt-queue` adds a queue for the first case and an instant interrupt for the second. Nothing changes until you ask: every session starts with Claude Code's normal behaviour.

## Install

```text
/plugin marketplace add GiuseppeBellamacina/cosmic-plugins
/plugin install prompt-queue@cosmic-plugins
```

Where `/plugin` isn't available (e.g. the VS Code extension), run these in a terminal, then `/reload-plugins` in the session:

```bash
claude plugin marketplace add GiuseppeBellamacina/cosmic-plugins
claude plugin install prompt-queue@cosmic-plugins
```

Requires a Claude Code build with plugin function hooks (mods). Nothing else to install.

## Commands

| Command | What it does |
| --- | --- |
| `/queue on` | Turns the queue on: from now on, what you send while Claude works waits in the queue. Claude knows nothing about it until it has finished everything it was doing; then the first queued message is sent automatically, then the next, one per finished task. |
| `/queue <message>` | Turns the queue on (if it was off) and adds the message to it, while Claude works or while it is idle. |
| `/queue off` | Back to Claude Code's normal behaviour (messages sent while Claude works steer the running task). Messages already queued still go out one per finished task, or **Clear** them. |
| `/now <message>` | Stops the running task at once and sends the message. Whatever was queued waits until this new task is finished. While Claude is idle there is nothing to stop, so it puts the text back in the prompt box and one Enter sends it. |

All of them work in the middle of a task. Every new session starts with the queue off.

## The queue

While the queue is on, or something is still queued, a band sits above the prompt:

```text
── prompt-queue ─────────────────────────────────────────────────────────────
Queue on · 2 queued                                                     Clear
1. also update the changelog when you're done                           ↑ ↓ ✕
2. then open a PR                                                       ↑ ↓ ✕
```

- **↑ / ↓** move a message, **✕** cancels it, **Clear** empties the queue.
- When a task ends normally, the first message is sent, as if you typed it.
- When a task is **interrupted** (Esc) or fails, the queue pauses instead of firing into a half-done state: the band says *paused*, and **Send next** sends the first message when you are ready. The next task that ends normally also resumes it.
- The band shares the space above the prompt with other plugins' bands.

## Limits

- **When a message is picked up.** Claude Code hands a message typed during a task to plugins only between two steps of that task (after the running command or tool call ends), so that is when it joins the queue. Your message shows in the transcript at once, with a *Prompt dropped by a hook: Queued as #n* line once it is queued; Claude never sees it before. `/queue <message>` and `/now` act at once.
- **Attachments.** A plugin cannot re-send pasted images or files, so a message with attachments is left to Claude Code's own handling (it steers the task) and a short notice says so.
- **`@file` mentions** in a queued message reach Claude as text: the file is not attached when the message is sent later.
- **Transcript.** Claude reads a queued message as your own words, but the transcript shows that the plugin sent it.
- **Slash commands** typed during a task are never queued: Claude Code runs them as usual.
- The queue lives in the session: it survives `/reload-plugins`, not a restart.

## How it works

One hooks module ([`hooks/register.tsx`](hooks/register.tsx)): with the queue on, a `prompt.submit` hook keeps the messages typed during a turn (`{ drop }`); `/now` stops the turn with `$.turn.abort`; a `turn.complete` hook sends the next message with `$.prompt.submit`; a `ui.render` hook on `AbovePrompt` draws the band. Tests are in [`tests/`](tests/) (`claude plugin test .`).

## License

[MIT](LICENSE)
