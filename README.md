# Mail2Task

Mail2Task is a Super Productivity plugin MVP that creates tasks from new IMAP
emails.

## Current Scope

- Desktop-first via Super Productivity `nodeExecution`.
- IMAP polling, read-only, using `EXAMINE` and `BODY.PEEK[]`.
- Password storage via `PluginAPI.setSecret/getSecret/deleteSecret`.
- Non-secret settings and dedupe state via `persistDataSynced`.
- Dedupe key: `accountKey + mailbox + UIDVALIDITY + UID`.
- Configurable metadata in task notes.
- Attachments are ignored and not listed.

## Files

- `manifest.json` - Super Productivity plugin manifest.
- `plugin.js` - background polling, IMAP worker, dedupe, task creation.
- `index.html` - iframe configuration and status UI.
- `icon.svg` - plugin icon.
- `MAIL2TASK-PLUGIN-NOTES.md` - design and architecture notes.

## Local Test

1. Open Super Productivity Desktop.
2. Load this folder as a plugin.
3. Grant `nodeExecution` only if you trust the local source.
4. Open Mail2Task from the side panel or plugin configuration.
5. Enter IMAP settings and save the password.
6. Run `Verbindung testen`.
7. Enable polling or run `Jetzt pruefen`.

## MVP Limitations

- No Web support: browsers cannot open raw IMAP sockets.
- No Mobile support yet: needs an upstream native IMAP bridge.
- No STARTTLS upgrade flow; use implicit TLS where possible.
- No destructive mail actions: mails are not deleted, moved, flagged or marked read.
- No attachment import or attachment listing in task notes.
- MIME parsing is intentionally minimal and optimized for common plaintext/HTML mails.

## Security Notes

The IMAP password is local-only and is not synced or exported by Super
Productivity's plugin secret API. At the current upstream state, secrets are
still plaintext at rest in the local app profile until an OS keychain-backed
implementation exists.
