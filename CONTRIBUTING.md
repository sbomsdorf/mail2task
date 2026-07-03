# Contributing to Mail2Task

Thank you for your interest in contributing to Mail2Task! This document provides guidelines and instructions for contributing.

## Code of Conduct

This project is committed to providing a welcoming and inclusive environment. Please:

- Be respectful and constructive
- Assume good intentions
- Focus on code and ideas, not individuals
- Report serious issues privately to maintainers

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- **Super Productivity** 14.0.2+
- Git
- Basic understanding of JavaScript and email protocols

### Development Setup

```bash
# Clone the repository
git clone https://github.com/sbomsdorf/mail2task.git
cd mail2task

# Install dependencies
npm install

# Run tests
npm test

# Watch mode during development
npm run test:watch
```

### Project Structure

```
mail2task/
├── plugin.js                      # Main plugin code & runtime
├── index.html                     # UI & configuration interface
├── manifest.json                  # Plugin metadata
├── tests/
│   ├── plugin.runtime.test.js     # Test suite
│   └── helpers/
│       └── loadPluginRuntime.js   # Test utilities
└── .github/workflows/ci.yml       # CI/CD pipeline
```

## Before You Start

1. Check [existing issues](https://github.com/sbomsdorf/mail2task/issues) – your feature might already be planned
2. For major changes, open an issue first to discuss the approach
3. Keep scope focused – we prefer multiple small PRs over monolithic changes

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
# or for bug fixes:
git checkout -b fix/your-bug-description
```

### 2. Make Changes

- Follow existing code style (consistent with `plugin.js`)
- Add tests for new functionality
- Update documentation if needed
- Keep commits focused and descriptive

### 3. Test Locally

```bash
# Run full test suite
npm test

# Test in Super Productivity Desktop:
# 1. Open Super Productivity
# 2. Settings → Plugins → Load Plugin from Folder
# 3. Select the mail2task directory
# 4. Reload and verify your changes
```

### 4. Commit & Push

```bash
git add .
git commit -m "feat: describe your changes concisely"
git push origin feature/your-feature-name
```

### 5. Open a Pull Request

- Use clear PR title and description
- Reference related issues with `Closes #123` or `Refs #456`
- Ensure CI passes (GitHub Actions will run automatically)
- Be ready to discuss and iterate on feedback

## Testing Guidelines

### Writing Tests

- Use **Vitest** framework (similar to Jest)
- Place tests in `tests/plugin.runtime.test.js`
- Test both happy paths and error cases
- Mock external dependencies (IMAP, PluginAPI)

### Test Template

```javascript
describe('Feature Name', () => {
  it('should do something specific', () => {
    // Arrange
    const runtime = loadPluginRuntime(makeBaseStore());
    
    // Act
    const result = runtime.api.someFunction();
    
    // Assert
    expect(result).toEqual(expectedValue);
  });

  it('should handle error case', () => {
    // Test error scenarios
  });
});
```

### Run Tests

```bash
npm test              # Run once
npm run test:watch   # Watch mode
```

## Code Style

- **Consistent indentation** – 2 spaces (enforced by existing code)
- **Meaningful variable names** – avoid abbreviations unless common
- **Comments for complex logic** – especially around race conditions, IMAP parsing
- **Error handling** – always handle errors gracefully, sanitize messages

### Example Pattern

```javascript
function sanitizeSensitiveText(value) {
  const sanitized = String(value || '')
    .replace(/LOGIN\s+\S+\s+\S+/gi, 'LOGIN <redacted> <redacted>')
    .replace(/AUTHENTICATE\s+\S+(\s+\S+)?/gi, 'AUTHENTICATE <redacted>')
    .trim();
  return sanitized.length > 600 
    ? `${sanitized.slice(0, 600)} ...` 
    : sanitized;
}
```

## Common Tasks

### Adding a New IMAP Command

1. Test with standard IMAP sequences
2. Add tests for success and failure cases
3. Sanitize any error messages
4. Document in code comments

### Modifying the UI (index.html)

1. Keep UI German (current locale) unless otherwise agreed
2. Ensure configuration options map to manifest permissions
3. Test with various screen sizes
4. Update corresponding tests

### Security-Sensitive Changes

1. Review credential handling carefully
2. Ensure passwords are never logged
3. Sanitize all error messages that might contain credentials
4. Consider upstream Security policy before implementing

## Commit Message Convention

Follow a simple convention for clear history:

```
type: brief description

Optional detailed explanation of why and what.

Closes #123
```

**Types:**
- `feat:` – New feature
- `fix:` – Bug fix
- `test:` – Test additions/changes
- `docs:` – Documentation
- `refactor:` – Code reorganization (no behavior change)
- `chore:` – Dependency updates, tooling

**Examples:**
```
feat: add STARTTLS support for port 587
fix: prevent race condition in command claim handler
test: expand redaction pattern coverage
docs: update installation instructions for Gmail
```

## Documentation Updates

- **README.md** – User-facing setup and features
- **MAIL2TASK-PLUGIN-NOTES.md** – Architecture & design decisions
- **Code comments** – Explain "why", not "what" (code shows what)
- **PR descriptions** – Help future maintainers understand context

## Reporting Security Issues

**Do not open public issues for security vulnerabilities.**

Please report security issues privately to Stefan Bomsdorf (maintainer) via:
- Email (if available on GitHub profile)
- Or create a private security advisory on GitHub

## Reporting Bugs

When reporting bugs, include:

1. **System info** – OS, Node version, Super Productivity version
2. **Steps to reproduce** – Clear, minimal reproduction
3. **Expected vs actual** – What should happen vs what happens
4. **Error message** – Full console/log output
5. **Your config** – IMAP server type, any custom settings

**Template:**

```
### System
- OS: macOS 14.0
- Node.js: 20.5.0
- Super Productivity: 14.0.5

### Steps to Reproduce
1. Configure Gmail IMAP
2. Enable polling
3. ...

### Expected Behavior
Tasks should import automatically

### Actual Behavior
Error: Connection timeout

### Logs
```

## Performance Considerations

- **IMAP polling** – Keep intervals reasonable (5+ minutes recommended)
- **Email parsing** – Limit body size (default 4000 chars)
- **State persistence** – Don't store unnecessary email data
- **Memory** – Test suite has 128MB limit per node execution

## Questions?

- 📖 Check existing [issues](https://github.com/sbomsdorf/mail2task/issues) and [discussions](https://github.com/sbomsdorf/mail2task/discussions)
- 💬 Start a discussion for questions
- 🐛 Open an issue for bugs
- 🔗 See [Super Productivity docs](https://github.com/johannesjo/super-productivity) for plugin framework questions

## Thank You!

We appreciate your contributions to making Mail2Task better for everyone. Every PR, issue, and piece of feedback helps!

Happy coding! 🚀
