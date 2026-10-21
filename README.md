# prompt-queue — decide what happens to a message you send while Claude is working

> Steer the running task, queue the message until the task is finished, or interrupt and send it now. The queue sits above the prompt, where you can reorder, cancel or clear it.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757.svg)](https://code.claude.com/docs/en/plugins)

In Claude Code, a message you send while Claude is working reaches it as soon as it has a moment: it **steers** the task in progress. That is often what you want, but not always:

- you thought of the **next** task, and do not want Claude to start mixing it into the current one;
- the current task went the wrong way, and you want it **stopped** in favour of the new message.

`prompt-queue` adds those two modes next to steering, and a visible queue you can edit.

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

## The three modes

While Claude is working, a band above the prompt shows the mode that applies to **Enter**:

```text
Enter while working: [Steer]  Queue  Interrupt   · 2 queued                  Clear
1. also update the changelog when you're done                           ↑ ↓ ✕
2. then open a PR                                                       ↑ ↓ ✕
```

| Mode | What Enter does while Claude works |
| --- | --- |
| **Steer** (default) | Claude Code's own behaviour: the message reaches Claude during the current task. |
| **Queue** | The message waits in the queue. Claude knows nothing about it until it has finished everything it was doing; then the first queued message is sent automatically, then the next, one per finished task. |
| **Interrupt** | The running task is stopped and the message is sent at once. Whatever was queued waits until this new task is finished. |

Click a mode to switch; the choice is remembered across sessions. Whatever the mode:

- **Ctrl+X Enter** (Claude Code's "wait for the turn" shortcut) always queues.
- `/queue <message>` queues one message, `/now <message>` interrupts with one message. Both work in the middle of a task. While Claude is idle there is nothing to wait for or interrupt, so they put the text back in the prompt box and one Enter sends it.

## The queue

- **↑ / ↓** move a message, **✕** cancels it, **Clear** empties the queue.
- When a task ends normally, the first message is sent, as if you typed it.
- When a task is **interrupted** (Esc) or fails, the queue pauses instead of firing into a half-done state: the band says *paused*, and **Send next** sends the first message when you are ready. The next task that ends normally also resumes it.
- The band shows only while Claude is working or something is queued. It shares the space above the prompt with other plugins' bands.

## Limits

- **Attachments.** A plugin cannot re-send pasted images or files, so a message with attachments is left to Claude Code's own handling (steering, or waiting with Ctrl+X Enter) and a short notice says so.
- **`@file` mentions** in a queued message reach Claude as text: the file is not attached when the message is sent later.
- **Transcript.** Claude reads a queued message as your own words, but the transcript shows that the plugin sent it.
- **Slash commands** typed during a task are never queued: Claude Code runs them as usual.
- The queue lives in the session: it survives `/reload-plugins`, not a restart.

## How it works

One hooks module ([`hooks/register.tsx`](hooks/register.tsx)): a `prompt.submit` hook catches messages typed during a turn and, depending on the mode, lets them through, keeps them (`{ drop }`), or stops the turn with `$.turn.abort`; a `turn.complete` hook sends the next message with `$.prompt.submit`; a `ui.render` hook on `AbovePrompt` draws the band. Tests are in [`tests/`](tests/) (`claude plugin test .`).

## License

[MIT](LICENSE)
