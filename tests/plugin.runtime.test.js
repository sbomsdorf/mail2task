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
  it('redacts LOGIN credentials with quoted username and password', () => {
    const runtime = loadPluginRuntime(makeBaseStore());

    const message = 'LOGIN "alice" "superSecret"';
    const sanitized = runtime.api.sanitizeSensitiveText(message);

    expect(sanitized).toContain('<redacted>');
    expect(sanitized).not.toContain('alice');
    expect(sanitized).not.toContain('superSecret');
  });

  it('redacts LOGIN credentials without quotes', () => {
    const runtime = loadPluginRuntime(makeBaseStore());

    const message = 'LOGIN alice superSecret';
    const sanitized = runtime.api.sanitizeSensitiveText(message);

    expect(sanitized).toBe('LOGIN <redacted> <redacted>');
    expect(sanitized).not.toContain('alice');
    expect(sanitized).not.toContain('superSecret');
  });

  it('redacts AUTHENTICATE with mechanism and payload', () => {
    const runtime = loadPluginRuntime(makeBaseStore());

    const message = 'AUTHENTICATE XOAUTH2 veryLongBlob123';
    const sanitized = runtime.api.sanitizeSensitiveText(message);

    expect(sanitized).toBe('AUTHENTICATE <redacted>');
    expect(sanitized).not.toContain('XOAUTH2');
    expect(sanitized).not.toContain('veryLongBlob123');
  });

  it('redacts AUTHENTICATE plain with password', () => {
    const runtime = loadPluginRuntime(makeBaseStore());

    const message = 'AUTHENTICATE PLAIN dGVzdA==';
    const sanitized = runtime.api.sanitizeSensitiveText(message);

    expect(sanitized).toBe('AUTHENTICATE <redacted>');
    expect(sanitized).not.toContain('PLAIN');
    expect(sanitized).not.toContain('dGVzdA==');
  });

  it('redacts password key-value pairs with colon separator', () => {
    const runtime = loadPluginRuntime(makeBaseStore());

    const message = 'Error: password: hunter2 failed';
    const sanitized = runtime.api.sanitizeSensitiveText(message);

    expect(sanitized).toContain('password=<redacted>');
    expect(sanitized).not.toContain('hunter2');
  });

  it('redacts pass key-value pairs with equals separator', () => {
    const runtime = loadPluginRuntime(makeBaseStore());

    const message = 'Config pass=mySecret123';
    const sanitized = runtime.api.sanitizeSensitiveText(message);

    expect(sanitized).toContain('pass=<redacted>');
    expect(sanitized).not.toContain('mySecret123');
  });

  it('redacts secret and token in quoted values', () => {
    const runtime = loadPluginRuntime(makeBaseStore());

    const message = 'secret="mySecret" token=\'bearerToken123\'';
    const sanitized = runtime.api.sanitizeSensitiveText(message);

    expect(sanitized).toContain('secret=<redacted>');
    expect(sanitized).toContain('token=<redacted>');
    expect(sanitized).not.toContain('mySecret');
    expect(sanitized).not.toContain('bearerToken123');
  });

  it('strips line breaks and carriage returns', () => {
    const runtime = loadPluginRuntime(makeBaseStore());

    const message = 'Line1\nLine2\rLine3';
    const sanitized = runtime.api.sanitizeSensitiveText(message);

    expect(sanitized).not.toContain('\n');
    expect(sanitized).not.toContain('\r');
    expect(sanitized).toContain('Line1');
    expect(sanitized).toContain('Line2');
    expect(sanitized).toContain('Line3');
  });

  it('truncates messages longer than 600 characters', () => {
    const runtime = loadPluginRuntime(makeBaseStore());

    const longMessage = 'Lorem ipsum '.repeat(100);
    const sanitized = runtime.api.sanitizeSensitiveText(longMessage);

    expect(sanitized.length).toBeLessThanOrEqual(610); // 600 + " ..."
    expect(sanitized).toContain('...');
  });

  it('handles empty and whitespace-only strings', () => {
    const runtime = loadPluginRuntime(makeBaseStore());

    expect(runtime.api.sanitizeSensitiveText('')).toBe('');
    expect(runtime.api.sanitizeSensitiveText('   ')).toBe('');
    expect(runtime.api.sanitizeSensitiveText(null)).toBe('');
  });

  it('combines multiple redaction patterns in single message', () => {
    const runtime = loadPluginRuntime(makeBaseStore());

    const message =
      'LOGIN alice pwd123\nAUTHENTICATE XOAUTH2 token456\nsecret=mySecret';
    const sanitized = runtime.api.sanitizeSensitiveText(message);

    expect(sanitized).toContain('LOGIN <redacted> <redacted>');
    expect(sanitized).toContain('AUTHENTICATE <redacted>');
    expect(sanitized).toContain('secret=<redacted>');
    expect(sanitized).not.toContain('alice');
    expect(sanitized).not.toContain('pwd123');
    expect(sanitized).not.toContain('token456');
    expect(sanitized).not.toContain('mySecret');
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
