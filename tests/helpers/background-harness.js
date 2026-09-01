import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const THIS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const BACKGROUND_PATH = resolve(THIS_DIRECTORY, "..", "..", "background.js");
const BACKGROUND_SOURCE = readFileSync(BACKGROUND_PATH, "utf8");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createEvent() {
  const listeners = [];

  return {
    addListener(listener) {
      listeners.push(listener);
    },

    get listenerCount() {
      return listeners.length;
    },

    get firstListener() {
      return listeners[0];
    },

    async emit(...args) {
      return Promise.all(listeners.map((listener) => listener(...args)));
    }
  };
}

export function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}

export function createBackgroundHarness(options = {}) {
  let now = options.now ?? new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
  let queryTabs = clone(options.initialTabs ?? []);
  const tabsById = new Map(queryTabs.map((tab) => [tab.id, clone(tab)]));
  const storageData = clone(options.initialStorage ?? {});
  const implementations = { ...(options.implementations ?? {}) };

  const calls = {
    idleSetDetectionInterval: [],
    storageGet: [],
    storageSet: [],
    tabsGet: [],
    tabsQuery: []
  };

  const events = {
    idleStateChanged: createEvent(),
    runtimeInstalled: createEvent(),
    runtimeMessage: createEvent(),
    tabActivated: createEvent(),
    tabRemoved: createEvent(),
    tabUpdated: createEvent(),
    windowFocusChanged: createEvent()
  };

  function defaultStorageGet(key) {
    if (key === null || key === undefined) return clone(storageData);

    const result = {};
    if (typeof key === "string") {
      if (Object.hasOwn(storageData, key)) result[key] = clone(storageData[key]);
      return result;
    }

    if (Array.isArray(key)) {
      for (const item of key) {
        if (Object.hasOwn(storageData, item)) result[item] = clone(storageData[item]);
      }
      return result;
    }

    for (const [item, fallback] of Object.entries(key)) {
      result[item] = Object.hasOwn(storageData, item)
        ? clone(storageData[item])
        : clone(fallback);
    }
    return result;
  }

  function defaultStorageSet(values) {
    for (const [key, value] of Object.entries(values)) {
      storageData[key] = clone(value);
    }
  }

  function defaultTabsGet(tabId) {
    if (!tabsById.has(tabId)) {
      throw new Error(`No tab with id ${tabId}`);
    }
    return clone(tabsById.get(tabId));
  }

  function defaultTabsQuery() {
    return clone(queryTabs);
  }

  const browser = {
    idle: {
      onStateChanged: events.idleStateChanged,
      setDetectionInterval(seconds) {
        calls.idleSetDetectionInterval.push(seconds);
      }
    },
    runtime: {
      onInstalled: events.runtimeInstalled,
      onMessage: events.runtimeMessage
    },
    storage: {
      local: {
        async get(key) {
          calls.storageGet.push(clone(key));
          const implementation = implementations.storageGet;
          return implementation
            ? implementation(key, defaultStorageGet)
            : defaultStorageGet(key);
        },
        async set(values) {
          calls.storageSet.push(clone(values));
          const implementation = implementations.storageSet;
          return implementation
            ? implementation(values, defaultStorageSet)
            : defaultStorageSet(values);
        }
      }
    },
    tabs: {
      onActivated: events.tabActivated,
      onRemoved: events.tabRemoved,
      onUpdated: events.tabUpdated,
      async get(tabId) {
        calls.tabsGet.push(tabId);
        const implementation = implementations.tabsGet;
        return implementation
          ? implementation(tabId, defaultTabsGet)
          : defaultTabsGet(tabId);
      },
      async query(queryInfo) {
        calls.tabsQuery.push(clone(queryInfo));
        const implementation = implementations.tabsQuery;
        return implementation
          ? implementation(queryInfo, defaultTabsQuery)
          : defaultTabsQuery(queryInfo);
      }
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: events.windowFocusChanged
    }
  };

  class ControlledDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(now);
      else super(...args);
    }

    static now() {
      return now;
    }
  }

  const context = vm.createContext({
    browser,
    console,
    Date: ControlledDate,
    URL
  });

  new vm.Script(BACKGROUND_SOURCE, { filename: BACKGROUND_PATH }).runInContext(context);

  function invoke(functionName, ...args) {
    context.__backgroundHarnessArgs = args;
    return vm.runInContext(
      `${functionName}(...__backgroundHarnessArgs)`,
      context
    );
  }

  async function settle() {
    await Promise.resolve();
    await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
    await Promise.resolve();
  }

  function state() {
    return JSON.parse(vm.runInContext("JSON.stringify(current)", context));
  }

  function resetCalls() {
    for (const entries of Object.values(calls)) entries.length = 0;
  }

  return {
    browser,
    calls,
    clock: {
      advance(milliseconds) {
        now += milliseconds;
        return now;
      },
      get now() {
        return now;
      },
      set(milliseconds) {
        now = milliseconds;
      }
    },
    events,
    implementations,
    invoke,
    ready: settle,
    resetCalls,
    setQueryTabs(tabs) {
      queryTabs = clone(tabs);
      for (const tab of queryTabs) tabsById.set(tab.id, clone(tab));
    },
    setTab(tab) {
      tabsById.set(tab.id, clone(tab));
    },
    state,
    storageSnapshot() {
      return clone(storageData);
    }
  };
}
