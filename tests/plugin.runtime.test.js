const {
  createSharedEnvironment,
  loadPluginRuntime,
} = require('./helpers/loadPluginRuntime');

function makeBaseStore(overrides) {
  return {
    config: {
      enabled: false,
      host: 'imap.example.org',
      port: 993,
      tls: true,
      username: 'alice',
      mailbox: 'INBOX',
      pollIntervalMinutes: 5,
      maxMessagesPerPoll: 10,
      bodyMaxChars: 4000,
      firstRunMode: 'newOnly',
      importLatestCount: 10,
      projectId: null,
      tagIds: [],
      timeEstimateMinutes: 0,
      metadataFields: {
        received: true,
        from: true,
        to: true,
        cc: false,
        originalSubject: true,
        messageId: true,
        mailbox: false,
        imapUid: false,
      },
    },
    state: {
      cursors: {},
      processed: {},
      lastPollAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      lastResult: null,
    },
    command: null,
    ...overrides,
  };
}

describe('sanitizeSensitiveText', () => {
  it('redacts LOGIN credentials and secret-like key-values', () => {
    const runtime = loadPluginRuntime(makeBaseStore());

    const message = 'LOGIN "alice" "superSecret" token=abc123';
    const sanitized = runtime.api.sanitizeSensitiveText(message);

    expect(sanitized).toContain('LOGIN <redacted> <redacted>');
    expect(sanitized).toContain('token=<redacted>');
    expect(sanitized).not.toContain('superSecret');
    expect(sanitized).not.toContain('abc123');
  });

  it('redacts AUTHENTICATE payloads and strips line breaks', () => {
    const runtime = loadPluginRuntime(makeBaseStore());

    const message = 'AUTHENTICATE XOAUTH2 veryLongBlob\npassword: hunter2';
    const sanitized = runtime.api.sanitizeSensitiveText(message);

    expect(sanitized).toContain('AUTHENTICATE <redacted>');
    expect(sanitized).toContain('password=<redacted>');
    expect(sanitized).not.toContain('\n');
  });
});

describe('handleCommand', () => {
  it('executes pending testConnection command and persists success result', async () => {
    const runtime = loadPluginRuntime(
      makeBaseStore({
        command: {
          id: 'cmd-1',
          type: 'testConnection',
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      }),
    );

    await runtime.api.handleCommand();

    const store = runtime.readStore();
    expect(runtime.calls.executeNodeScript).toBe(1);
    expect(store.command.status).toBe('success');
    expect(store.command.result).toMatchObject({
      mailbox: 'INBOX',
      uidValidity: 42,
      uidNext: 1337,
    });
    expect(store.command.finishedAt).toBeTypeOf('string');
  });

  it('prevents duplicate execution for parallel calls in one runtime instance', async () => {
    const runtime = loadPluginRuntime(
      makeBaseStore({
        command: {
          id: 'cmd-2',
          type: 'testConnection',
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      }),
    );

    await Promise.all([
      runtime.api.handleCommand(),
      runtime.api.handleCommand(),
    ]);

    expect(runtime.calls.executeNodeScript).toBe(1);
    expect(runtime.readStore().command.status).toBe('success');
  });

  it('does not rerun command across instances after first one persisted success', async () => {
    const env = createSharedEnvironment(
      makeBaseStore({
        command: {
          id: 'cmd-3',
          type: 'testConnection',
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      }),
    );
    const runtimeA = loadPluginRuntime(env);
    const runtimeB = loadPluginRuntime(env);

    await runtimeA.api.handleCommand();
    await runtimeB.api.handleCommand();

    expect(env.calls.executeNodeScript).toBe(1);
    expect(runtimeA.readStore().command.status).toBe('success');
  });

  it('allows only one execution when two instances race on pending command', async () => {
    const env = createSharedEnvironment(
      makeBaseStore({
        command: {
          id: 'cmd-4',
          type: 'testConnection',
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      }),
      {
        persistDelayMs: 15,
      },
    );
    const runtimeA = loadPluginRuntime(env);
    const runtimeB = loadPluginRuntime(env);

    await Promise.all([runtimeA.api.handleCommand(), runtimeB.api.handleCommand()]);

    expect(env.calls.executeNodeScript).toBe(1);
    expect(runtimeA.readStore().command.status).toBe('success');
  });
});
