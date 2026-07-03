(function () {
  'use strict';

  const SECRET_KEY = 'imapPassword';
  const MAX_PROCESSED_RECORDS = 2000;
  const COMMAND_STATUS_TTL_MS = 24 * 60 * 60 * 1000;

  const DEFAULT_METADATA_FIELDS = {
    received: true,
    from: true,
    to: true,
    cc: false,
    originalSubject: true,
    messageId: true,
    mailbox: false,
    imapUid: false,
  };

  const DEFAULT_CONFIG = {
    enabled: false,
    host: '',
    port: 993,
    tls: true,
    username: '',
    mailbox: 'INBOX',
    pollIntervalMinutes: 5,
    maxMessagesPerPoll: 10,
    bodyMaxChars: 4000,
    firstRunMode: 'newOnly',
    importLatestCount: 10,
    projectId: null,
    tagIds: [],
    timeEstimateMinutes: 0,
    metadataFields: DEFAULT_METADATA_FIELDS,
  };

  let pollTimerId = null;
  let isPolling = false;
  let activeCommandId = null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function sanitizeSensitiveText(value) {
    return String(value || '')
      .replace(
        /LOGIN\s+"(?:\\.|[^"])*"\s+"(?:\\.|[^"])*"/gi,
        'LOGIN "<redacted>" "<redacted>"',
      )
      .replace(/LOGIN\s+\S+\s+\S+/gi, 'LOGIN <redacted> <redacted>')
      .replace(/[\r\n]+/g, ' ')
      .trim();
  }

  function parseJson(value, fallback) {
    if (!value) {
      return clone(fallback);
    }
    try {
      return JSON.parse(value);
    } catch (_error) {
      return clone(fallback);
    }
  }

  function normalizeConfig(config) {
    const source = config && typeof config === 'object' ? config : {};
    const merged = {
      ...clone(DEFAULT_CONFIG),
      ...source,
      metadataFields: {
        ...clone(DEFAULT_METADATA_FIELDS),
        ...(source.metadataFields || {}),
      },
    };

    merged.host = String(merged.host || '').trim();
    merged.username = String(merged.username || '').trim();
    merged.mailbox = String(merged.mailbox || 'INBOX').trim() || 'INBOX';
    merged.port = clampNumber(merged.port, 1, 65535, merged.tls ? 993 : 143);
    merged.pollIntervalMinutes = clampNumber(merged.pollIntervalMinutes, 1, 1440, 5);
    merged.maxMessagesPerPoll = clampNumber(merged.maxMessagesPerPoll, 1, 50, 10);
    merged.bodyMaxChars = clampNumber(merged.bodyMaxChars, 500, 50000, 4000);
    merged.importLatestCount = clampNumber(merged.importLatestCount, 1, 50, 10);
    merged.timeEstimateMinutes = clampNumber(merged.timeEstimateMinutes, 0, 1440, 0);
    merged.firstRunMode =
      merged.firstRunMode === 'latestN' ? 'latestN' : 'newOnly';
    merged.projectId = merged.projectId || null;
    merged.tagIds = Array.isArray(merged.tagIds) ? merged.tagIds.filter(Boolean) : [];
    merged.tls = merged.tls !== false;
    merged.enabled = merged.enabled === true;
    return merged;
  }

  function normalizeStore(store) {
    const source = store && typeof store === 'object' ? store : {};
    const state = source.state && typeof source.state === 'object' ? source.state : {};
    return {
      config: normalizeConfig(source.config),
      state: {
        cursors: state.cursors && typeof state.cursors === 'object' ? state.cursors : {},
        processed:
          state.processed && typeof state.processed === 'object' ? state.processed : {},
        lastPollAt: state.lastPollAt || null,
        lastSuccessAt: state.lastSuccessAt || null,
        lastErrorAt: state.lastErrorAt || null,
        lastError: state.lastError || null,
        lastResult: state.lastResult || null,
      },
      command:
        source.command && typeof source.command === 'object' ? source.command : null,
    };
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  async function loadStore() {
    const raw = await PluginAPI.loadSyncedData();
    return normalizeStore(parseJson(raw, { config: DEFAULT_CONFIG, state: {} }));
  }

  async function saveStore(store) {
    await PluginAPI.persistDataSynced(JSON.stringify(normalizeStore(store)));
  }

  async function updateStore(mutator) {
    const latest = await loadStore();
    mutator(latest);
    await saveStore(latest);
    return latest;
  }

  function configReady(config) {
    return Boolean(config.host && config.username && config.mailbox);
  }

  function getExecutor() {
    const pluginRef = typeof plugin !== 'undefined' ? plugin : null;
    if (pluginRef && typeof pluginRef.executeNodeScript === 'function') {
      return pluginRef;
    }
    if (typeof PluginAPI.executeNodeScript === 'function') {
      return PluginAPI;
    }
    return null;
  }

  async function getPassword() {
    if (typeof PluginAPI.getSecret !== 'function') {
      throw new Error('Secret storage is not available in this Super Productivity build.');
    }
    const password = await PluginAPI.getSecret(SECRET_KEY);
    if (!password) {
      throw new Error('No IMAP password saved for this device.');
    }
    return password;
  }

  async function runImapRequest(request) {
    const executor = getExecutor();
    if (!executor) {
      throw new Error('nodeExecution is not available. Mail2Task needs the desktop app.');
    }
    const result = await executor.executeNodeScript({
      script: buildImapWorkerScript(),
      args: [request],
      timeout: 120000,
    });
    if (!result || !result.success) {
      const error = result && result.error ? result.error : 'Unknown nodeExecution error';
      throw new Error(typeof error === 'string' ? error : error.message || String(error));
    }
    return result.result;
  }

  function accountKey(config) {
    return hashString(
      [config.host.toLowerCase(), config.port, config.username.toLowerCase()].join('|'),
    );
  }

  function cursorKey(config, uidValidity) {
    return [accountKey(config), config.mailbox, String(uidValidity)].join('|');
  }

  function dedupeKey(config, uidValidity, uid) {
    return [accountKey(config), config.mailbox, String(uidValidity), String(uid)].join('|');
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  async function testConnection() {
    const store = await loadStore();
    const config = normalizeConfig(store.config);
    assertRunnableConfig(config);
    const password = await getPassword();
    return runImapRequest({
      mode: 'status',
      config: toImapConfig(config, password),
    });
  }

  async function pollNow(reason) {
    if (isPolling) {
      return { skipped: true, reason: 'already-running' };
    }

    isPolling = true;
    let store = await loadStore();
    const startedAt = nowIso();
    try {
      const config = normalizeConfig(store.config);
      if (reason === 'timer' && !config.enabled) {
        return { skipped: true, reason: 'disabled' };
      }
      assertRunnableConfig(config);
      const password = await getPassword();
      const status = await runImapRequest({
        mode: 'status',
        config: toImapConfig(config, password),
      });

      store = await loadStore();
      const key = cursorKey(config, status.uidValidity);
      let cursor = store.state.cursors[key];
      let messages = [];
      let initialized = false;

      if (!cursor) {
        if (config.firstRunMode === 'newOnly') {
          cursor = {
            uidValidity: status.uidValidity,
            highestSeenUid: Math.max(0, Number(status.uidNext || 1) - 1),
            initializedAt: startedAt,
          };
          store.state.cursors[key] = cursor;
          initialized = true;
        } else {
          const fetchResult = await runImapRequest({
            mode: 'fetchLatest',
            config: toImapConfig(config, password),
            maxMessages: config.importLatestCount,
            bodyMaxChars: config.bodyMaxChars,
          });
          messages = fetchResult.messages || [];
          cursor = {
            uidValidity: fetchResult.uidValidity,
            highestSeenUid: 0,
            initializedAt: startedAt,
          };
          store.state.cursors[key] = cursor;
        }
      } else {
        const fromUid = Number(cursor.highestSeenUid || 0) + 1;
        const fetchResult = await runImapRequest({
          mode: 'fetchFrom',
          config: toImapConfig(config, password),
          fromUid,
          maxMessages: config.maxMessagesPerPoll,
          bodyMaxChars: config.bodyMaxChars,
        });
        messages = fetchResult.messages || [];
      }

      const creationResult = await createTasksForMessages(store, config, cursor, messages);
      pruneProcessed(store.state.processed);
      store.state.lastPollAt = startedAt;
      store.state.lastSuccessAt = nowIso();
      store.state.lastErrorAt = null;
      store.state.lastError = null;
      store.state.lastResult = {
        reason,
        created: creationResult.created,
        skipped: creationResult.skipped,
        fetched: messages.length,
        initialized,
        mailbox: config.mailbox,
        uidValidity: status.uidValidity,
        at: nowIso(),
      };
      await updateStore((latest) => {
        latest.state.cursors = store.state.cursors;
        latest.state.processed = store.state.processed;
        latest.state.lastPollAt = store.state.lastPollAt;
        latest.state.lastSuccessAt = store.state.lastSuccessAt;
        latest.state.lastErrorAt = store.state.lastErrorAt;
        latest.state.lastError = store.state.lastError;
        latest.state.lastResult = store.state.lastResult;
      });
      return store.state.lastResult;
    } catch (error) {
      const safeError = readableError(error);
      await updateStore((latest) => {
        latest.state.lastPollAt = startedAt;
        latest.state.lastErrorAt = nowIso();
        latest.state.lastError = safeError;
        latest.state.lastResult = {
          reason,
          created: 0,
          skipped: 0,
          fetched: 0,
          error: safeError,
          at: nowIso(),
        };
      });
      throw error;
    } finally {
      isPolling = false;
    }
  }

  async function createTasksForMessages(store, config, cursor, messages) {
    let created = 0;
    let skipped = 0;
    let highestHandled = Number(cursor.highestSeenUid || 0);
    const sortedMessages = messages
      .slice()
      .sort((a, b) => Number(a.uid || 0) - Number(b.uid || 0));

    for (const message of sortedMessages) {
      const uid = Number(message.uid || 0);
      if (!uid) {
        skipped += 1;
        continue;
      }
      const key = dedupeKey(config, cursor.uidValidity, uid);
      if (store.state.processed[key]) {
        highestHandled = Math.max(highestHandled, uid);
        skipped += 1;
        continue;
      }

      const taskId = await PluginAPI.addTask(buildTaskData(config, message));
      store.state.processed[key] = {
        taskId,
        processedAt: nowIso(),
        mailbox: config.mailbox,
        uidValidity: cursor.uidValidity,
        uid,
        messageId: message.messageId || null,
        subject: message.subject || '',
      };
      highestHandled = Math.max(highestHandled, uid);
      created += 1;
    }

    cursor.highestSeenUid = highestHandled;
    cursor.updatedAt = nowIso();
    return { created, skipped };
  }

  function buildTaskData(config, message) {
    const cleanSubject = normalizeSubject(message.subject || '(no subject)');
    const sender = senderLabel(message.from || '');
    const title = `${sender ? `${sender}: ` : ''}${cleanSubject}`.slice(0, 500);
    const task = {
      title,
      notes: buildNotes(config, message, cleanSubject),
      isDone: false,
    };
    if (config.projectId) {
      task.projectId = config.projectId;
    }
    if (config.tagIds.length) {
      task.tagIds = config.tagIds;
    }
    if (config.timeEstimateMinutes > 0) {
      task.timeEstimate = config.timeEstimateMinutes * 60 * 1000;
    }
    return task;
  }

  function buildNotes(config, message, cleanSubject) {
    const fields = config.metadataFields || DEFAULT_METADATA_FIELDS;
    const lines = ['## Email', ''];
    const meta = [];

    if (fields.from && message.from) {
      meta.push(['From', message.from]);
    }
    if (fields.to && message.to) {
      meta.push(['To', message.to]);
    }
    if (fields.cc && message.cc) {
      meta.push(['Cc', message.cc]);
    }
    if (fields.received && message.date) {
      meta.push(['Received', message.date]);
    }
    if (
      fields.originalSubject &&
      message.subject &&
      message.subject.trim() !== cleanSubject.trim()
    ) {
      meta.push(['Subject', message.subject]);
    }
    if (fields.messageId && message.messageId) {
      meta.push(['Message-ID', message.messageId]);
    }
    if (fields.mailbox) {
      meta.push(['Mailbox', config.mailbox]);
    }
    if (fields.imapUid) {
      meta.push([
        'IMAP',
        `UIDVALIDITY ${message.uidValidity || ''} / UID ${message.uid || ''}`.trim(),
      ]);
    }

    for (const [label, value] of meta) {
      lines.push(`- ${label}: ${escapeMarkdownInline(String(value))}`);
    }
    if (!meta.length) {
      lines.push('- No metadata selected');
    }

    lines.push('', '## Body', '');
    const body = String(message.bodyText || '').trim();
    if (body) {
      for (const line of body.split(/\r?\n/)) {
        lines.push(`> ${escapeMarkdownInline(line)}`);
      }
    } else {
      lines.push('> (empty body)');
    }
    return lines.join('\n');
  }

  function normalizeSubject(subject) {
    let value = String(subject || '').replace(/\s+/g, ' ').trim();
    const prefixRe =
      /^(re|aw|antw|antwort|fw|fwd|wg|wtr|weiterleitung|sv|vs)(\s*(\[\d+\]|\(\d+\)|\d+))?\s*[:：]\s*/i;
    let previous = '';
    while (value && value !== previous) {
      previous = value;
      value = value.replace(prefixRe, '').trim();
    }
    return value || '(no subject)';
  }

  function senderLabel(from) {
    const value = String(from || '').trim();
    if (!value) {
      return '';
    }
    const match = value.match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
    return (match ? match[1] : value).trim().slice(0, 120);
  }

  function escapeMarkdownInline(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/[\\`*_{}\[\]()#+!|]/g, '\\$&');
  }

  function toImapConfig(config, password) {
    return {
      host: config.host,
      port: config.port,
      tls: config.tls,
      username: config.username,
      password,
      mailbox: config.mailbox,
    };
  }

  function assertRunnableConfig(config) {
    if (!configReady(config)) {
      throw new Error('IMAP host, username and mailbox are required.');
    }
  }

  function readableError(error) {
    if (!error) {
      return 'Unknown error';
    }
    return sanitizeSensitiveText(error.message || String(error));
  }

  function pruneProcessed(processed) {
    const entries = Object.entries(processed);
    if (entries.length <= MAX_PROCESSED_RECORDS) {
      return;
    }
    entries
      .sort((a, b) => String(a[1].processedAt).localeCompare(String(b[1].processedAt)))
      .slice(0, entries.length - MAX_PROCESSED_RECORDS)
      .forEach(([key]) => {
        delete processed[key];
      });
  }

  function clearTimer() {
    if (pollTimerId !== null) {
      clearInterval(pollTimerId);
      pollTimerId = null;
    }
  }

  async function refreshTimer() {
    clearTimer();
    const store = await loadStore();
    const config = normalizeConfig(store.config);
    if (!config.enabled || !configReady(config)) {
      return;
    }
    pollTimerId = setInterval(() => {
      pollNow('timer').catch((error) => {
        PluginAPI.log.warn('Mail2Task poll failed', readableError(error));
      });
    }, config.pollIntervalMinutes * 60 * 1000);
  }

  async function handleCommand() {
    let store = await loadStore();
    const command = store.command;
    if (!command || command.status !== 'pending' || command.id === activeCommandId) {
      return;
    }
    activeCommandId = command.id;
    try {
      const started = nowIso();
      const markedRunning = await updateStore((latest) => {
        if (
          latest.command &&
          latest.command.id === command.id &&
          latest.command.status === 'pending'
        ) {
          latest.command.status = 'running';
          latest.command.startedAt = started;
        }
      });
      if (!markedRunning.command || markedRunning.command.id !== command.id) {
        return;
      }

      let result;
      if (command.type === 'testConnection') {
        result = await testConnection();
      } else if (command.type === 'runNow') {
        result = await pollNow('manual');
      } else {
        throw new Error(`Unknown command: ${command.type}`);
      }

      await updateStore((latest) => {
        if (latest.command && latest.command.id === command.id) {
          latest.command.status = 'success';
          latest.command.finishedAt = nowIso();
          latest.command.result = summarizeCommandResult(command.type, result);
          cleanupCommand(latest);
        }
      });
      PluginAPI.showSnack({
        msg:
          command.type === 'testConnection'
            ? 'Mail2Task connection test successful'
            : 'Mail2Task poll finished',
        type: 'SUCCESS',
      });
    } catch (error) {
      const safeError = readableError(error);
      await updateStore((latest) => {
        if (latest.command && latest.command.id === command.id) {
          latest.command.status = 'error';
          latest.command.finishedAt = nowIso();
          latest.command.error = safeError;
          cleanupCommand(latest);
        }
      });
      PluginAPI.showSnack({
        msg: `Mail2Task: ${safeError}`,
        type: 'ERROR',
      });
    } finally {
      activeCommandId = null;
    }
  }

  function summarizeCommandResult(type, result) {
    if (type === 'testConnection') {
      return {
        mailbox: result.mailbox,
        exists: result.exists,
        uidValidity: result.uidValidity,
        uidNext: result.uidNext,
      };
    }
    return result;
  }

  function cleanupCommand(store) {
    if (!store.command || !store.command.finishedAt) {
      return;
    }
    const finishedAt = new Date(store.command.finishedAt).getTime();
    if (Number.isFinite(finishedAt) && Date.now() - finishedAt > COMMAND_STATUS_TTL_MS) {
      store.command = null;
    }
  }

  function registerUi() {
    PluginAPI.registerConfigHandler(() => {
      PluginAPI.showIndexHtmlAsView();
    });
    PluginAPI.registerMenuEntry({
      label: 'Mail2Task: check now',
      icon: 'mark_email_unread',
      onClick: () => {
        pollNow('manual-menu').catch((error) => {
          PluginAPI.showSnack({
            msg: `Mail2Task: ${readableError(error)}`,
            type: 'ERROR',
          });
        });
      },
    });
  }

  async function init() {
    registerUi();
    PluginAPI.registerHook(PluginAPI.Hooks.PERSISTED_DATA_CHANGED, () => {
      refreshTimer().catch((error) => {
        PluginAPI.log.warn('Mail2Task timer refresh failed', readableError(error));
      });
      handleCommand().catch((error) => {
        PluginAPI.log.warn('Mail2Task command failed', readableError(error));
      });
    });
    await refreshTimer();
    await handleCommand();
  }

  function buildImapWorkerScript() {
    return `
      return await (async function mail2TaskImapWorker(params) {
        const tls = require('tls');
        const net = require('net');

        const DEFAULT_TIMEOUT_MS = 30000;

        class ImapConnection {
          constructor(config) {
            this.config = config;
            this.socket = null;
            this.buffer = '';
            this.tagNo = 0;
          }

          connect() {
            return new Promise((resolve, reject) => {
              const options = {
                host: this.config.host,
                port: this.config.port,
                servername: this.config.host,
                rejectUnauthorized: true,
              };
              const onError = (error) => reject(error);
              this.socket = this.config.tls
                ? tls.connect(options, () => resolve())
                : net.connect(options, () => resolve());
              this.socket.setEncoding('latin1');
              this.socket.setTimeout(DEFAULT_TIMEOUT_MS, () => {
                this.socket.destroy(new Error('IMAP connection timed out'));
              });
              this.socket.once('error', onError);
              this.socket.on('data', (chunk) => {
                this.buffer += chunk;
              });
            }).then(() => this.waitForUntaggedGreeting());
          }

          waitForUntaggedGreeting() {
            return this.waitFor((text) => /^\\* (OK|PREAUTH) /m.test(text));
          }

          waitFor(predicate) {
            return new Promise((resolve, reject) => {
              const startedAt = Date.now();
              const tick = () => {
                if (predicate(this.buffer)) {
                  resolve(this.buffer);
                  return;
                }
                if (Date.now() - startedAt > DEFAULT_TIMEOUT_MS) {
                  reject(new Error('Timed out waiting for IMAP response'));
                  return;
                }
                setTimeout(tick, 15);
              };
              tick();
            });
          }

          nextTag() {
            this.tagNo += 1;
            return 'A' + String(this.tagNo).padStart(4, '0');
          }

          async command(commandText) {
            const tag = this.nextTag();
            this.buffer = '';
            this.socket.write(tag + ' ' + commandText + '\\r\\n');
            const response = await this.waitFor((text) =>
              new RegExp('^' + tag + ' (OK|NO|BAD)', 'm').test(text),
            );
            const finalLine = response
              .split(/\\r?\\n/)
              .find((line) => line.startsWith(tag + ' '));
            if (!finalLine || !finalLine.startsWith(tag + ' OK')) {
              const commandName = String(commandText || '').trim().split(/\s+/)[0] || 'UNKNOWN';
              const safeFinalLine = sanitizeErrorLine(finalLine || '');
              throw new Error(
                safeFinalLine
                  ? 'IMAP command failed (' + commandName + '): ' + safeFinalLine
                  : 'IMAP command failed (' + commandName + ')',
              );
            }
            return response;
          }

          async login() {
            await this.command(
              'LOGIN ' + quote(this.config.username) + ' ' + quote(this.config.password),
            );
          }

          async examine() {
            const response = await this.command('EXAMINE ' + quoteMailbox(this.config.mailbox));
            return parseSelectStatus(response, this.config.mailbox);
          }

          async uidSearch(criteria) {
            const response = await this.command('UID SEARCH ' + criteria);
            const line = response.split(/\\r?\\n/).find((item) => item.startsWith('* SEARCH'));
            if (!line) {
              return [];
            }
            return line
              .replace(/^\\* SEARCH\\s*/, '')
              .trim()
              .split(/\\s+/)
              .filter(Boolean)
              .map((uid) => Number(uid))
              .filter((uid) => Number.isFinite(uid) && uid > 0);
          }

          async uidFetchRaw(uids) {
            if (!uids.length) {
              return '';
            }
            return this.command('UID FETCH ' + compactUidSet(uids) + ' (UID BODY.PEEK[])');
          }

          async logout() {
            try {
              await this.command('LOGOUT');
            } catch (_error) {
              // Best effort only.
            }
            if (this.socket) {
              this.socket.end();
            }
          }
        }

        function quote(value) {
          return (
            '"' +
            String(value || '')
              .replace(/[\r\n]/g, ' ')
              .replace(/\\\\/g, '\\\\\\\\')
              .replace(/"/g, '\\\\"') +
            '"'
          );
        }

        function sanitizeErrorLine(value) {
          return String(value || '')
            .replace(
              /LOGIN\s+"(?:\\.|[^"])*"\s+"(?:\\.|[^"])*"/gi,
              'LOGIN "<redacted>" "<redacted>"',
            )
            .replace(/LOGIN\s+\S+\s+\S+/gi, 'LOGIN <redacted> <redacted>')
            .replace(/[\r\n]+/g, ' ')
            .trim();
        }

        function quoteMailbox(value) {
          return quote(value || 'INBOX');
        }

        function parseSelectStatus(response, mailbox) {
          const uidValidityMatch = response.match(/\\[UIDVALIDITY\\s+(\\d+)\\]/i);
          const uidNextMatch = response.match(/\\[UIDNEXT\\s+(\\d+)\\]/i);
          const existsMatch = response.match(/^\\*\\s+(\\d+)\\s+EXISTS/im);
          return {
            mailbox,
            uidValidity: uidValidityMatch ? Number(uidValidityMatch[1]) : 0,
            uidNext: uidNextMatch ? Number(uidNextMatch[1]) : 1,
            exists: existsMatch ? Number(existsMatch[1]) : 0,
          };
        }

        function compactUidSet(uids) {
          const sorted = Array.from(new Set(uids)).sort((a, b) => a - b);
          const ranges = [];
          let start = null;
          let previous = null;
          for (const uid of sorted) {
            if (start === null) {
              start = uid;
              previous = uid;
              continue;
            }
            if (uid === previous + 1) {
              previous = uid;
              continue;
            }
            ranges.push(start === previous ? String(start) : start + ':' + previous);
            start = uid;
            previous = uid;
          }
          if (start !== null) {
            ranges.push(start === previous ? String(start) : start + ':' + previous);
          }
          return ranges.join(',');
        }

        function extractFetchedMessages(fetchResponse, bodyMaxChars, uidValidity) {
          const messages = [];
          let index = 0;
          while (index < fetchResponse.length) {
            const marker = fetchResponse.slice(index).match(/\\*\\s+\\d+\\s+FETCH\\s+\\([^\\r\\n]*UID\\s+(\\d+)[\\s\\S]*?\\{(\\d+)\\}\\r\\n/i);
            if (!marker) {
              break;
            }
            const markerStart = index + marker.index;
            const literalStart = markerStart + marker[0].length;
            const literalLength = Number(marker[2]);
            const literalEnd = literalStart + literalLength;
            const rawBinary = fetchResponse.slice(literalStart, literalEnd);
            const raw = Buffer.from(rawBinary, 'latin1').toString('utf8');
            const parsed = parseMessage(raw, bodyMaxChars);
            parsed.uid = Number(marker[1]);
            parsed.uidValidity = uidValidity;
            messages.push(parsed);
            index = literalEnd;
          }
          return messages;
        }

        function parseMessage(raw, bodyMaxChars) {
          const split = raw.search(/\\r?\\n\\r?\\n/);
          const rawHeaders = split >= 0 ? raw.slice(0, split) : raw;
          const rawBody = split >= 0 ? raw.slice(split).replace(/^\\r?\\n\\r?\\n/, '') : '';
          const headers = parseHeaders(rawHeaders);
          return {
            subject: decodeHeader(headers.subject || ''),
            from: decodeHeader(headers.from || ''),
            to: decodeHeader(headers.to || ''),
            cc: decodeHeader(headers.cc || ''),
            date: decodeHeader(headers.date || ''),
            messageId: decodeHeader(headers['message-id'] || ''),
            bodyText: extractBodyText(headers, rawBody).slice(0, bodyMaxChars),
          };
        }

        function parseHeaders(rawHeaders) {
          const headers = {};
          const unfolded = rawHeaders.replace(/\\r?\\n[\\t ]+/g, ' ');
          for (const line of unfolded.split(/\\r?\\n/)) {
            const idx = line.indexOf(':');
            if (idx <= 0) {
              continue;
            }
            const key = line.slice(0, idx).trim().toLowerCase();
            const value = line.slice(idx + 1).trim();
            headers[key] = headers[key] ? headers[key] + ', ' + value : value;
          }
          return headers;
        }

        function extractBodyText(headers, rawBody) {
          const contentType = headers['content-type'] || 'text/plain';
          if (/multipart\\//i.test(contentType)) {
            const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);
            if (!boundaryMatch) {
              return '';
            }
            const parts = splitMultipart(rawBody, boundaryMatch[1]);
            const parsedParts = parts.map(parsePart).filter(Boolean);
            const plain = parsedParts.find((part) => part.type === 'text/plain');
            if (plain) {
              return normalizeText(plain.text);
            }
            const html = parsedParts.find((part) => part.type === 'text/html');
            return html ? htmlToText(html.text) : '';
          }
          const decoded = decodeTransfer(rawBody, headers['content-transfer-encoding']);
          if (/text\\/html/i.test(contentType)) {
            return htmlToText(decoded);
          }
          return normalizeText(decoded);
        }

        function splitMultipart(rawBody, boundary) {
          const delimiter = '--' + boundary;
          return rawBody
            .split(delimiter)
            .slice(1)
            .map((part) => part.replace(/^\\r?\\n/, '').replace(/\\r?\\n--\\s*$/, ''))
            .filter((part) => part.trim());
        }

        function parsePart(rawPart) {
          const split = rawPart.search(/\\r?\\n\\r?\\n/);
          if (split < 0) {
            return null;
          }
          const headers = parseHeaders(rawPart.slice(0, split));
          const disposition = headers['content-disposition'] || '';
          if (/attachment/i.test(disposition) || /filename\\s*=/i.test(disposition)) {
            return null;
          }
          const contentType = (headers['content-type'] || 'text/plain').toLowerCase();
          const body = rawPart.slice(split).replace(/^\\r?\\n\\r?\\n/, '');
          if (/multipart\\//i.test(contentType)) {
            const nestedBoundary = contentType.match(/boundary="?([^";]+)"?/i);
            if (!nestedBoundary) {
              return null;
            }
            const nested = splitMultipart(body, nestedBoundary[1])
              .map(parsePart)
              .filter(Boolean);
            return nested.find((part) => part.type === 'text/plain') || nested[0] || null;
          }
          if (!/^text\\/(plain|html)/i.test(contentType)) {
            return null;
          }
          return {
            type: /^text\\/html/i.test(contentType) ? 'text/html' : 'text/plain',
            text: decodeTransfer(body, headers['content-transfer-encoding']),
          };
        }

        function decodeTransfer(value, encoding) {
          const enc = String(encoding || '').toLowerCase();
          if (enc.includes('base64')) {
            return Buffer.from(String(value).replace(/\\s+/g, ''), 'base64').toString('utf8');
          }
          if (enc.includes('quoted-printable')) {
            return decodeQuotedPrintable(String(value));
          }
          return String(value || '');
        }

        function decodeQuotedPrintable(value) {
          const softLineBreaks = value.replace(/=\\r?\\n/g, '');
          const binary = softLineBreaks.replace(/=([0-9A-F]{2})/gi, (_match, hex) =>
            String.fromCharCode(parseInt(hex, 16)),
          );
          return Buffer.from(binary, 'latin1').toString('utf8');
        }

        function decodeHeader(value) {
          return String(value || '').replace(/=\\?([^?]+)\\?([bqBQ])\\?([^?]+)\\?=/g, (
            _match,
            charset,
            encoding,
            text,
          ) => {
            try {
              const buffer =
                encoding.toLowerCase() === 'b'
                  ? Buffer.from(text, 'base64')
                  : Buffer.from(
                      text
                        .replace(/_/g, ' ')
                        .replace(/=([0-9A-F]{2})/gi, (_m, hex) =>
                          String.fromCharCode(parseInt(hex, 16)),
                        ),
                      'latin1',
                    );
              return decodeBuffer(buffer, charset);
            } catch (_error) {
              return text;
            }
          });
        }

        function decodeBuffer(buffer, charset) {
          const normalized = String(charset || '').toLowerCase();
          if (normalized.includes('iso-8859-1') || normalized.includes('latin1')) {
            return buffer.toString('latin1');
          }
          return buffer.toString('utf8');
        }

        function htmlToText(html) {
          return normalizeText(
            decodeEntities(
              String(html || '')
                .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
                .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
                .replace(/<(br|p|div|li|tr|h[1-6])\\b[^>]*>/gi, '\\n')
                .replace(/<[^>]+>/g, ' '),
            ),
          );
        }

        function decodeEntities(value) {
          return String(value || '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/g, "'");
        }

        function normalizeText(value) {
          return String(value || '')
            .replace(/\\r\\n/g, '\\n')
            .replace(/\\r/g, '\\n')
            .replace(/[\\t ]+\\n/g, '\\n')
            .replace(/\\n{4,}/g, '\\n\\n\\n')
            .trim();
        }

        async function main() {
          if (!params || !params.config) {
            throw new Error('Missing IMAP request config');
          }
          const config = params.config;
          const connection = new ImapConnection(config);
          await connection.connect();
          try {
            await connection.login();
            const status = await connection.examine();
            if (!status.uidValidity) {
              throw new Error('Mailbox did not provide UIDVALIDITY');
            }
            if (params.mode === 'status') {
              return status;
            }

            let uids = [];
            if (params.mode === 'fetchLatest') {
              uids = await connection.uidSearch('ALL');
              uids = uids.slice(-Math.max(1, Number(params.maxMessages || 10)));
            } else if (params.mode === 'fetchFrom') {
              const fromUid = Math.max(1, Number(params.fromUid || 1));
              uids = await connection.uidSearch('UID ' + fromUid + ':*');
              uids = uids.slice(0, Math.max(1, Number(params.maxMessages || 10)));
            } else {
              throw new Error('Unknown IMAP worker mode: ' + params.mode);
            }

            const fetchResponse = await connection.uidFetchRaw(uids);
            return {
              ...status,
              messages: extractFetchedMessages(
                fetchResponse,
                Math.max(500, Number(params.bodyMaxChars || 4000)),
                status.uidValidity,
              ),
            };
          } finally {
            await connection.logout();
          }
        }

        return main();
      })(args[0]);
    `;
  }

  const ready =
    typeof plugin !== 'undefined' && plugin && typeof plugin.onReady === 'function'
      ? plugin.onReady.bind(plugin)
      : typeof PluginAPI.onReady === 'function'
        ? PluginAPI.onReady.bind(PluginAPI)
        : null;

  if (typeof plugin !== 'undefined' && plugin && typeof plugin.onUnload === 'function') {
    plugin.onUnload(() => {
      clearTimer();
    });
  } else if (typeof PluginAPI.onUnload === 'function') {
    PluginAPI.onUnload(() => {
      clearTimer();
    });
  }

  if (ready) {
    ready(() => {
      init().catch((error) => {
        PluginAPI.log.err('Mail2Task init failed', readableError(error));
      });
    });
  } else {
    init().catch((error) => {
      PluginAPI.log.err('Mail2Task init failed', readableError(error));
    });
  }
})();
