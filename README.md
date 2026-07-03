# Mail2Task

[![CI](https://github.com/sbomsdorf/mail2task/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sbomsdorf/mail2task/actions/workflows/ci.yml)
[![GitHub Issues](https://img.shields.io/github/issues/sbomsdorf/mail2task.svg)](https://github.com/sbomsdorf/mail2task/issues)
[![Super Productivity Docs](https://img.shields.io/badge/Super%20Productivity-Docs-blue.svg)](https://github.com/johannesjo/super-productivity)
<a href="https://buymeacoffee.com/sbomsdorf" target="_blank" rel="noopener noreferrer"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 20px !important;" /></a>

> Automatically import emails from IMAP mailboxes into [Super Productivity](https://github.com/johannesjo/super-productivity) tasks.

Mail2Task is a Super Productivity plugin that continuously monitors IMAP mailboxes and converts new emails into actionable tasks, enabling seamless integration of email-driven workflows with your productivity system.

## Features

- ✉️ **IMAP Integration** – Connect to any IMAP server (Gmail, Outlook, self-hosted, etc.)
- 🔄 **Automatic Polling** – Background polling with configurable intervals
- 🔐 **Secure Password Storage** – Credentials stored locally via Super Productivity's secret API
- 📧 **Smart Deduplication** – Never create duplicate tasks for the same email
- 📋 **Configurable Metadata** – Choose which email fields to include in task notes (From, To, CC, Subject, Date, Message-ID, etc.)
- 🛡️ **Security-First** – Read-only access, encrypted error messages, no email modifications
- 🔒 **Multi-Instance Safe** – Prevents race conditions when running multiple plugin instances
- ✅ **Full Test Coverage** – 15 comprehensive tests for reliability

## Requirements

- **Super Productivity** v14.0.2 or later ([download](https://github.com/johannesjo/super-productivity/releases))
- **Desktop app** (Web support not yet available – browsers cannot open raw IMAP sockets)
- **Node.js execution** permission in Super Productivity settings
- **IMAP-enabled email account** (Gmail, Outlook, ProtonMail with Bridge, etc.)

## Installation

### 1. Download/Clone the Plugin

```bash
git clone https://github.com/sbomsdorf/mail2task.git
cd mail2task
npm install
```

### 2. Load into Super Productivity

1. Open **Super Productivity** Desktop app
2. Go to **Settings** → **Plugins**
3. Click **Load Plugin from Folder**
4. Select the `mail2task` directory
5. When prompted, grant `nodeExecution` permission (required for IMAP operations)

### 3. Configure Mail2Task

1. Open Mail2Task from the side panel or plugin configuration
2. Enter your IMAP settings:
   - **Server** (e.g., `imap.gmail.com`)
   - **Port** (typically `993` for implicit TLS)
   - **Username** (your email address)
   - **Password** (stored securely locally)
3. Select target **mailbox** (default: `INBOX`)
4. Configure polling interval and metadata fields
5. Click **Verbindung testen** to verify connection

### 4. Start Importing

- Enable **Polling** for automatic checks, or
- Click **Jetzt pruefen** for manual sync

## Configuration

### Email Metadata Fields

Choose which fields are included in generated task notes:

| Field | Description |
|-------|-------------|
| Received | Email date/time |
| From | Sender address |
| To | Primary recipient |
| CC | Carbon copy recipients |
| Subject | Original email subject |
| Message-ID | IMAP unique identifier |
| Mailbox | Source mailbox name |
| IMAP UID | Internal email UID |

### Polling Settings

- **Interval** – Check mailbox every N minutes (1–1440 min)
- **Max Messages** – Fetch up to N new emails per poll (1–50)
- **Body Length** – Limit email body in task notes (500–50000 chars)

### Task Defaults

- **Project** – Destination project for created tasks
- **Tags** – Auto-apply tags to all imported tasks
- **Time Estimate** – Default estimated minutes per task
- **Import Mode** – On first run, import only new emails or latest N

## Security & Privacy

### Password Storage

- ✅ Passwords stored locally by Super Productivity's secret API
- ℹ️ Current upstream limitation: secrets are plaintext at rest until OS keychain integration
- 🔒 Recommended: use [app-specific passwords](https://support.google.com/accounts/answer/185833) (Gmail) or similar

### Data Access

- 📖 **Read-only** IMAP access (emails not modified, deleted, or flagged)
- 🔍 **No attachments** imported or stored
- 🛡️ **Error messages sanitized** to prevent credential leaks in logs

### IMAP Commands

- `EXAMINE` – Read-only mailbox inspection
- `BODY.PEEK[]` – Fetch email without marking as read

## Architecture

- **Polling Daemon** – Background task running per configured interval
- **Deduplication** – Keyed by `accountKey + mailbox + UIDVALIDITY + UID`
- **Race Protection** – Multi-instance ownership claims prevent duplicate execution
- **State Persistence** – Task cursor and processed email set saved locally

See [MAIL2TASK-PLUGIN-NOTES.md](MAIL2TASK-PLUGIN-NOTES.md) for detailed architecture and design decisions.

## Limitations

- 🌐 **No Web support** – browsers cannot open raw IMAP sockets
- 📱 **No mobile** yet – requires native bridge from Super Productivity
- 🔄 **No STARTTLS** – use implicit TLS (port 993) where possible
- 📎 **No attachments** – email bodies and headers only
- 🧵 **Minimal MIME** – optimized for plaintext/HTML, not complex multipart structures

## Development

### Run Tests

```bash
npm test              # Run full suite
npm run test:watch   # Watch mode
```

### Project Structure

```
mail2task/
├── plugin.js                    # Main plugin runtime & IMAP worker
├── index.html                   # Configuration & status UI
├── manifest.json                # Plugin metadata & permissions
├── icon.svg                     # Plugin icon
├── package.json                 # Dependencies & scripts
├── vitest.config.js             # Test runner config
├── tests/
│   ├── plugin.runtime.test.js   # Integration tests
│   └── helpers/
│       └── loadPluginRuntime.js # Test harness
├── .github/workflows/ci.yml     # GitHub Actions CI
└── README.md                    # This file
```

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Add tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Submit a pull request

## Related Projects

- [Super Productivity](https://github.com/johannesjo/super-productivity) – The main project
- [Super Productivity Plugin Docs](https://github.com/johannesjo/super-productivity/wiki/Plugins) – Plugin development guide
- [IMAP Specification](https://tools.ietf.org/html/rfc3501) – RFC 3501

## License

This project is licensed under the **MIT License** – see [LICENSE](LICENSE) for details.

## Want to Contribute?

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to get started, coding standards, testing requirements, and our development workflow.

---

**Status:** Stable MVP | **Super Productivity:** ≥14.0.2 | **Node.js:** ≥18 | **Last Updated:** 2026-07-03
