# Contributing

The plugin is one hooks module (`hooks/register.tsx`), its state contract (`types/index.d.ts`) and its tests (`tests/`).

## Ground rules

- A queued message never reaches Claude before the running turn has ended normally (or the person presses **Send next**).
- Nothing is lost silently: what the plugin cannot hold (attachments) goes to Claude Code's own handling, with a notice.
- No dependencies.

## Develop

```bash
git clone https://github.com/GiuseppeBellamacina/prompt-queue
claude plugin validate ./prompt-queue
claude plugin test ./prompt-queue
claude --plugin-dir ./prompt-queue       # try it in a session
```

## Pull requests

- One topic per PR, with a test in `tests/` for the behaviour it changes.
- Run `claude plugin validate .` and `claude plugin test .` before opening it.
- Update `README.md` when behaviour changes.
