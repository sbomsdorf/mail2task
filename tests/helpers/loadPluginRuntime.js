const fs = require('fs');
const path = require('path');
const vm = require('vm');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeSharedStore(initialStore) {
  return {
    value: JSON.stringify(initialStore),
  };
}
function createSharedEnvironment(initialStore, options = {}) {
  return {
    __mail2taskEnv: true,
    sharedStore: makeSharedStore(initialStore),
    options,
    calls: {
      executeNodeScript: 0,
      addTask: 0,
      snacks: [],
      warnings: [],
      errors: [],
    },
  };
}

function createPluginApi(env) {
  const calls = env.calls;
  const sharedStore = env.sharedStore;

  const executeNodeScriptImpl =
    typeof env.options.executeNodeScriptImpl === 'function'
      ? env.options.executeNodeScriptImpl
      : null;

  const persistDelayMs = Number(env.options.persistDelayMs || 0);

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
      if (persistDelayMs > 0) {
        await sleep(persistDelayMs);
      }
      sharedStore.value = value;
    },
    async getSecret() {
      return 'test-password';
    },
    async executeNodeScript(payload) {
      calls.executeNodeScript += 1;
      if (executeNodeScriptImpl) {
        return executeNodeScriptImpl(payload, env);
      }
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
    async addTask() {
      calls.addTask += 1;
      return { id: 'task-id' };
    },
  };

  return { PluginAPI, calls };
}

function loadPluginRuntime(initialStoreOrEnv, options = {}) {
  const env =
    initialStoreOrEnv && initialStoreOrEnv.__mail2taskEnv
      ? initialStoreOrEnv
      : createSharedEnvironment(initialStoreOrEnv, options);

  const { PluginAPI, calls } = createPluginApi(env);

  const pluginPath = path.resolve(__dirname, '..', '..', 'plugin.js');
  const source = fs.readFileSync(pluginPath, 'utf8');
  const instrumented = source.replace(
    /\}\)\(\);\s*$/,
    "\n  globalThis.__mail2taskTest = {\n    sanitizeSensitiveText,\n    readableError,\n    normalizeConfig,\n    normalizeStore,\n    handleCommand,\n    loadStore,\n    pollNow,\n  };\n})();\n",
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
    env,
    readStore: () => JSON.parse(env.sharedStore.value),
    writeRawStore: (store) => {
      env.sharedStore.value = JSON.stringify(store);
    },
  };
}

module.exports = {
  createSharedEnvironment,
  loadPluginRuntime,
};
