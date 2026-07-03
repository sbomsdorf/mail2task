const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeSharedStore(initialStore) {
  return {
    value: JSON.stringify(initialStore),
  };
}

function createPluginApi(sharedStore) {
  const calls = {
    executeNodeScript: 0,
    createTask: 0,
    snacks: [],
    warnings: [],
    errors: [],
  };

  const PluginAPI = {
    Hooks: {
      PERSISTED_DATA_CHANGED: 'PERSISTED_DATA_CHANGED',
    },
    onReady() {},
    onUnload() {},
    registerHook() {},
    registerConfigHandler() {},
    registerMenuEntry() {},
    showSnack(payload) {
      calls.snacks.push(payload);
    },
    log: {
      warn(...args) {
        calls.warnings.push(args);
      },
      err(...args) {
        calls.errors.push(args);
      },
    },
    async loadSyncedData() {
      return sharedStore.value;
    },
    async persistDataSynced(value) {
      sharedStore.value = value;
    },
    async getSecret() {
      return 'test-password';
    },
    async executeNodeScript(payload) {
      calls.executeNodeScript += 1;
      const request = payload && payload.args ? payload.args[0] : null;
      if (!request || request.mode === 'status') {
        return {
          success: true,
          result: {
            mailbox: 'INBOX',
            exists: 1,
            uidValidity: 42,
            uidNext: 1337,
          },
        };
      }
      return {
        success: true,
        result: {
          mailbox: 'INBOX',
          exists: 1,
          uidValidity: 42,
          uidNext: 1337,
          messages: [],
        },
      };
    },
    async createTask() {
      calls.createTask += 1;
      return { id: 'task-id' };
    },
  };

  return { PluginAPI, calls };
}

function loadPluginRuntime(initialStore) {
  const sharedStore = makeSharedStore(initialStore);
  const { PluginAPI, calls } = createPluginApi(sharedStore);

  const pluginPath = path.resolve(__dirname, '..', '..', 'plugin.js');
  const source = fs.readFileSync(pluginPath, 'utf8');
  const instrumented = source.replace(
    /\}\)\(\);\s*$/,
    "\n  globalThis.__mail2taskTest = {\n    sanitizeSensitiveText,\n    readableError,\n    normalizeConfig,\n    normalizeStore,\n    handleCommand,\n    loadStore,\n  };\n})();\n",
  );

  const context = {
    PluginAPI,
    plugin: undefined,
    Buffer,
    console,
    Date,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(instrumented, context, { filename: 'plugin.js' });

  return {
    api: context.__mail2taskTest,
    calls,
    readStore: () => JSON.parse(sharedStore.value),
    writeRawStore: (store) => {
      sharedStore.value = JSON.stringify(store);
    },
  };
}

module.exports = {
  loadPluginRuntime,
};
