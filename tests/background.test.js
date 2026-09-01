import { describe, expect, it } from "vitest";

import {
  createBackgroundHarness,
  deferred
} from "./helpers/background-harness.js";

function localTime(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  return new Date(year, month - 1, day, hour, minute, second, millisecond).getTime();
}

async function settledHarness(options = {}) {
  const harness = createBackgroundHarness(options);
  await harness.ready();
  harness.resetCalls();
  return harness;
}

describe("background helpers", () => {
  describe("dayKey", () => {
    it("formats a supplied date in local calendar time with zero padding", async () => {
      const harness = await settledHarness();

      expect(harness.invoke("dayKey", new Date(2026, 0, 2, 23, 59, 59))).toBe("2026-01-02");
      expect(harness.invoke("dayKey", new Date(2024, 1, 29, 12, 0, 0))).toBe("2024-02-29");
    });

    it("uses the current clock when no date is supplied", async () => {
      const now = localTime(2026, 9, 7, 8, 30);
      const harness = await settledHarness({ now });

      expect(harness.invoke("dayKey")).toBe("2026-09-07");
    });
  });

  describe("hostnameForUrl", () => {
    it.each([
      ["https://www.Example.COM/path?q=1#hash", "example.com"],
      ["http://example.com:8080/path", "example.com"],
      ["https://sub.www.example.com/", "sub.www.example.com"],
      ["https://www2.example.com/", "www2.example.com"],
      ["http://localhost:3000/", "localhost"]
    ])("normalizes a trackable URL %s", async (url, expected) => {
      const harness = await settledHarness();

      expect(harness.invoke("hostnameForUrl", url)).toBe(expected);
    });

    it.each([
      "about:config",
      "file:///tmp/index.html",
      "ftp://example.com/file",
      "moz-extension://extension-id/popup.html",
      "not a URL",
      "",
      null,
      undefined
    ])("rejects an untrackable or malformed URL %s", async (url) => {
      const harness = await settledHarness();

      expect(harness.invoke("hostnameForUrl", url)).toBeNull();
    });
  });
});

describe("duration persistence", () => {
  it("does nothing for an absent domain, absent start, or non-positive interval", async () => {
    const harness = await settledHarness();
    const start = localTime(2026, 1, 15, 12);

    await harness.invoke("addDuration", null, start, start + 1_000);
    await harness.invoke("addDuration", "example.com", null, start + 1_000);
    await harness.invoke("addDuration", "example.com", start, start);
    await harness.invoke("addDuration", "example.com", start, start - 1);

    expect(harness.calls.storageGet).toEqual([]);
    expect(harness.calls.storageSet).toEqual([]);
    expect(harness.storageSnapshot()).toEqual({});
  });

  it("creates a daily bucket and records fractional seconds", async () => {
    const harness = await settledHarness();
    const start = localTime(2026, 1, 15, 12);

    await harness.invoke("addDuration", "example.com", start, start + 1_250);

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "example.com": 1.25 }
    });
  });

  it("adds to an existing domain while preserving other domains", async () => {
    const harness = await settledHarness({
      initialStorage: {
        "stats:2026-01-15": {
          "example.com": 2,
          "other.test": 7
        }
      }
    });
    const start = localTime(2026, 1, 15, 12);

    await harness.invoke("addDuration", "example.com", start, start + 1_500);

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": {
        "example.com": 3.5,
        "other.test": 7
      }
    });
  });

  it("splits an interval at local midnight", async () => {
    const harness = await settledHarness();
    const start = localTime(2026, 1, 15, 23, 59, 59, 250);
    const end = localTime(2026, 1, 16, 0, 0, 1, 750);

    await harness.invoke("addDuration", "example.com", start, end);

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "example.com": 0.75 },
      "stats:2026-01-16": { "example.com": 1.75 }
    });
  });

  it("splits an interval across every day it spans without zero-length chunks", async () => {
    const harness = await settledHarness();
    const start = localTime(2026, 1, 15, 23, 59);
    const end = localTime(2026, 1, 17, 0, 1);

    await harness.invoke("addDuration", "example.com", start, end);

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "example.com": 60 },
      "stats:2026-01-16": { "example.com": 86_400 },
      "stats:2026-01-17": { "example.com": 60 }
    });
    expect(harness.calls.storageSet).toHaveLength(3);
  });

  it("propagates a storage read error without attempting a write", async () => {
    const harness = await settledHarness();
    const error = new Error("read failed");
    harness.implementations.storageGet = async () => {
      throw error;
    };
    const start = localTime(2026, 1, 15, 12);

    await expect(
      harness.invoke("addDuration", "example.com", start, start + 1_000)
    ).rejects.toBe(error);
    expect(harness.calls.storageSet).toEqual([]);
  });

  it("propagates a storage write error", async () => {
    const harness = await settledHarness();
    const error = new Error("write failed");
    harness.implementations.storageSet = async () => {
      throw error;
    };
    const start = localTime(2026, 1, 15, 12);

    await expect(
      harness.invoke("addDuration", "example.com", start, start + 1_000)
    ).rejects.toBe(error);
  });

  it.fails("KNOWN CONCURRENCY DEFECT: preserves both domains during simultaneous read-modify-write updates", async () => {
    const harness = await settledHarness();
    const readGates = [deferred(), deferred()];
    let readIndex = 0;
    harness.implementations.storageGet = (key, defaultGet) => {
      const snapshot = defaultGet(key);
      const gate = readGates[readIndex++];
      return gate.promise.then(() => snapshot);
    };
    const start = localTime(2026, 1, 15, 12);

    const first = harness.invoke("addDuration", "first.test", start, start + 1_000);
    const second = harness.invoke("addDuration", "second.test", start, start + 2_000);
    readGates[0].resolve();
    readGates[1].resolve();
    await Promise.all([first, second]);

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": {
        "first.test": 1,
        "second.test": 2
      }
    });
  });
});

describe("tracking state transitions", () => {
  it("starts the queried HTTP tab when the background script initializes", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = createBackgroundHarness({
      now,
      initialTabs: [{ id: 10, active: true, url: "https://www.example.com/page" }]
    });

    await harness.ready();

    expect(harness.state()).toEqual({
      tabId: 10,
      hostname: "example.com",
      startedAt: now,
      windowFocused: true,
      userActive: true
    });
  });

  it("initializes with no tracked interval when no active tab is returned", async () => {
    const harness = await settledHarness();

    expect(harness.state()).toEqual({
      tabId: null,
      hostname: null,
      startedAt: null,
      windowFocused: true,
      userActive: true
    });
  });

  it("swallows a failed startup tab query", async () => {
    const harness = createBackgroundHarness({
      implementations: {
        tabsQuery: async () => {
          throw new Error("query failed");
        }
      }
    });

    await harness.ready();

    expect(harness.state().hostname).toBeNull();
    expect(harness.calls.tabsQuery).toHaveLength(1);
  });

  it("stops an active interval, persists it, and retains the current tab id", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 10, active: true, url: "https://example.com" }]
    });
    harness.clock.advance(2_500);

    await harness.invoke("stopTracking", harness.clock.now);

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "example.com": 2.5 }
    });
    expect(harness.state()).toMatchObject({
      tabId: 10,
      hostname: null,
      startedAt: null
    });
  });

  it("stopping with no active interval performs no storage work", async () => {
    const harness = await settledHarness();

    await harness.invoke("stopTracking");

    expect(harness.calls.storageGet).toEqual([]);
    expect(harness.calls.storageSet).toEqual([]);
  });

  it("switches tabs by flushing the old domain at the supplied transition time", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://first.test" }]
    });
    const transitionTime = harness.clock.advance(4_000);

    await harness.invoke(
      "startTrackingTab",
      { id: 2, active: true, url: "https://www.second.test/path" },
      transitionTime
    );

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "first.test": 4 }
    });
    expect(harness.state()).toMatchObject({
      tabId: 2,
      hostname: "second.test",
      startedAt: transitionTime
    });
  });

  it("flushes the old domain but does not track an unsupported destination", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://first.test" }]
    });
    const transitionTime = harness.clock.advance(1_000);

    await harness.invoke(
      "startTrackingTab",
      { id: 2, active: true, url: "about:config" },
      transitionTime
    );

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "first.test": 1 }
    });
    expect(harness.state()).toMatchObject({
      tabId: 2,
      hostname: null,
      startedAt: null
    });
  });

  it("does not begin tracking while the window is unfocused", async () => {
    const harness = await settledHarness();
    await harness.events.windowFocusChanged.emit(harness.browser.windows.WINDOW_ID_NONE);

    await harness.invoke("startTrackingTab", {
      id: 2,
      active: true,
      url: "https://example.com"
    });

    expect(harness.state()).toMatchObject({
      tabId: 2,
      hostname: null,
      windowFocused: false
    });
  });

  it("does not begin tracking while the user is idle", async () => {
    const harness = await settledHarness();
    await harness.events.idleStateChanged.emit("idle");

    await harness.invoke("startTrackingTab", {
      id: 2,
      active: true,
      url: "https://example.com"
    });

    expect(harness.state()).toMatchObject({
      tabId: 2,
      hostname: null,
      userActive: false
    });
  });

  it("refreshes from the first active tab and timestamps before the asynchronous query", async () => {
    const harness = await settledHarness();
    const queryGate = deferred();
    harness.implementations.tabsQuery = () => queryGate.promise;
    const requestedAt = harness.clock.now;

    const refresh = harness.invoke("refreshFromActiveTab");
    harness.clock.advance(5_000);
    queryGate.resolve([{ id: 4, active: true, url: "https://example.com" }]);
    await refresh;

    expect(harness.calls.tabsQuery).toEqual([
      { active: true, currentWindow: true }
    ]);
    expect(harness.state()).toMatchObject({
      tabId: 4,
      hostname: "example.com",
      startedAt: requestedAt
    });
  });

  it("refreshing with no active tab stops and clears the tracked tab", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://example.com" }]
    });
    harness.clock.advance(3_000);
    harness.setQueryTabs([]);

    await harness.invoke("refreshFromActiveTab");

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "example.com": 3 }
    });
    expect(harness.state()).toMatchObject({
      tabId: null,
      hostname: null,
      startedAt: null
    });
  });

  it("propagates a refresh query failure", async () => {
    const harness = await settledHarness();
    const error = new Error("query failed");
    harness.implementations.tabsQuery = async () => {
      throw error;
    };

    await expect(harness.invoke("refreshFromActiveTab")).rejects.toBe(error);
  });

  it.fails("KNOWN CONCURRENCY DEFECT: flushes an interval at most once when stop transitions overlap", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://example.com" }]
    });
    harness.clock.advance(10_000);
    const firstWrite = deferred();
    let readCount = 0;
    harness.implementations.storageGet = async (key, defaultGet) => {
      readCount += 1;
      if (readCount === 2) await firstWrite.promise;
      return defaultGet(key);
    };
    let writeCount = 0;
    harness.implementations.storageSet = (values, defaultSet) => {
      defaultSet(values);
      writeCount += 1;
      if (writeCount === 1) firstWrite.resolve();
    };

    await Promise.all([
      harness.invoke("stopTracking", harness.clock.now),
      harness.invoke("stopTracking", harness.clock.now)
    ]);

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "example.com": 10 }
    });
  });
});

describe("WebExtension event wiring", () => {
  it("registers every listener once, configures idle detection, and starts one initial refresh", async () => {
    const harness = createBackgroundHarness();
    await harness.ready();

    expect(harness.events.tabActivated.listenerCount).toBe(1);
    expect(harness.events.tabUpdated.listenerCount).toBe(1);
    expect(harness.events.tabRemoved.listenerCount).toBe(1);
    expect(harness.events.windowFocusChanged.listenerCount).toBe(1);
    expect(harness.events.idleStateChanged.listenerCount).toBe(1);
    expect(harness.events.runtimeMessage.listenerCount).toBe(1);
    expect(harness.events.runtimeInstalled.listenerCount).toBe(1);
    expect(harness.calls.idleSetDetectionInterval).toEqual([60]);
    expect(harness.calls.tabsQuery).toEqual([
      { active: true, currentWindow: true }
    ]);
  });

  it("switches to an activated tab", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://first.test" }]
    });
    harness.setTab({ id: 2, active: true, url: "https://second.test" });
    harness.clock.advance(2_000);

    await harness.events.tabActivated.emit({ tabId: 2, windowId: 20 });

    expect(harness.calls.tabsGet).toEqual([2]);
    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "first.test": 2 }
    });
    expect(harness.state()).toMatchObject({
      tabId: 2,
      hostname: "second.test"
    });
  });

  it("stops tracking when an activated tab can no longer be read", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://first.test" }]
    });
    harness.clock.advance(2_000);

    await harness.events.tabActivated.emit({ tabId: 999, windowId: 20 });

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "first.test": 2 }
    });
    expect(harness.state()).toMatchObject({
      tabId: 1,
      hostname: null,
      startedAt: null
    });
  });

  it.fails("KNOWN CONCURRENCY DEFECT: keeps the newest activation when an older tab lookup finishes last", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://first.test" }]
    });
    harness.setTab({ id: 2, active: true, url: "https://second.test" });
    harness.setTab({ id: 3, active: true, url: "https://third.test" });
    const olderLookup = deferred();
    harness.implementations.tabsGet = async (tabId, defaultGet) => {
      if (tabId === 2) await olderLookup.promise;
      return defaultGet(tabId);
    };

    const olderActivation = harness.events.tabActivated.emit({ tabId: 2, windowId: 20 });
    const newerActivation = harness.events.tabActivated.emit({ tabId: 3, windowId: 20 });
    await newerActivation;
    olderLookup.resolve();
    await olderActivation;

    expect(harness.state()).toMatchObject({
      tabId: 3,
      hostname: "third.test"
    });
  });

  it.each([
    ["a different tab", 99, { url: "https://second.test" }, { id: 99, active: true, url: "https://second.test" }],
    ["an inactive tab", 1, { url: "https://second.test" }, { id: 1, active: false, url: "https://second.test" }],
    ["a status-only change", 1, { status: "complete" }, { id: 1, active: true, url: "https://first.test" }]
  ])("ignores an update for %s", async (_label, tabId, changeInfo, tab) => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://first.test" }]
    });
    const before = harness.state();

    await harness.events.tabUpdated.emit(tabId, changeInfo, tab);

    expect(harness.state()).toEqual(before);
    expect(harness.calls.storageGet).toEqual([]);
  });

  it("switches domains when the tracked tab URL changes", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://first.test" }]
    });
    harness.clock.advance(1_500);

    await harness.events.tabUpdated.emit(
      1,
      { url: "https://second.test/page" },
      { id: 1, active: true, url: "https://second.test/page" }
    );

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "first.test": 1.5 }
    });
    expect(harness.state()).toMatchObject({
      tabId: 1,
      hostname: "second.test"
    });
  });

  it("ignores removal of an unrelated tab", async () => {
    const harness = await settledHarness({
      initialTabs: [{ id: 1, active: true, url: "https://first.test" }]
    });
    const before = harness.state();

    await harness.events.tabRemoved.emit(2, { windowId: 20, isWindowClosing: false });

    expect(harness.state()).toEqual(before);
    expect(harness.calls.storageGet).toEqual([]);
  });

  it("flushes and clears the tracked tab when it is removed", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://first.test" }]
    });
    harness.clock.advance(3_000);

    await harness.events.tabRemoved.emit(1, { windowId: 20, isWindowClosing: false });

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "first.test": 3 }
    });
    expect(harness.state()).toMatchObject({
      tabId: null,
      hostname: null,
      startedAt: null
    });
  });

  it("stops at the focus-loss timestamp and marks the browser unfocused", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://first.test" }]
    });
    harness.clock.advance(4_000);

    await harness.events.windowFocusChanged.emit(harness.browser.windows.WINDOW_ID_NONE);

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "first.test": 4 }
    });
    expect(harness.state()).toMatchObject({
      hostname: null,
      windowFocused: false
    });
  });

  it("refreshes the active tab when a browser window gains focus", async () => {
    const harness = await settledHarness();
    await harness.events.windowFocusChanged.emit(harness.browser.windows.WINDOW_ID_NONE);
    harness.setQueryTabs([{ id: 2, active: true, url: "https://focused.test" }]);
    harness.resetCalls();

    await harness.events.windowFocusChanged.emit(20);

    expect(harness.calls.tabsQuery).toEqual([
      { active: true, currentWindow: true }
    ]);
    expect(harness.state()).toMatchObject({
      tabId: 2,
      hostname: "focused.test",
      windowFocused: true
    });
  });

  it.each(["idle", "locked"])("stops tracking when the idle state becomes %s", async (idleState) => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://example.com" }]
    });
    harness.clock.advance(5_000);

    await harness.events.idleStateChanged.emit(idleState);

    expect(harness.storageSnapshot()).toEqual({
      "stats:2026-01-15": { "example.com": 5 }
    });
    expect(harness.state()).toMatchObject({
      hostname: null,
      startedAt: null,
      userActive: false
    });
  });

  it("refreshes the active tab when the user becomes active in a focused window", async () => {
    const harness = await settledHarness({
      initialTabs: [{ id: 1, active: true, url: "https://first.test" }]
    });
    await harness.events.idleStateChanged.emit("idle");
    harness.setQueryTabs([{ id: 2, active: true, url: "https://second.test" }]);
    harness.resetCalls();

    await harness.events.idleStateChanged.emit("active");

    expect(harness.calls.tabsQuery).toHaveLength(1);
    expect(harness.state()).toMatchObject({
      tabId: 2,
      hostname: "second.test",
      userActive: true
    });
  });

  it("does not query or track when the user becomes active while unfocused", async () => {
    const harness = await settledHarness();
    await harness.events.windowFocusChanged.emit(harness.browser.windows.WINDOW_ID_NONE);
    harness.resetCalls();

    await harness.events.idleStateChanged.emit("active");

    expect(harness.calls.tabsQuery).toEqual([]);
    expect(harness.state()).toMatchObject({
      hostname: null,
      windowFocused: false,
      userActive: true
    });
  });

  it("refreshes after installation", async () => {
    const harness = await settledHarness();
    harness.setQueryTabs([{ id: 7, active: true, url: "https://installed.test" }]);

    await harness.events.runtimeInstalled.emit({ reason: "install" });

    expect(harness.state()).toMatchObject({
      tabId: 7,
      hostname: "installed.test"
    });
  });

  it.fails("KNOWN CONCURRENCY DEFECT: keeps the newest refresh when an older tab query finishes last", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://first.test" }]
    });
    const olderQuery = deferred();
    let queryCount = 0;
    harness.implementations.tabsQuery = async () => {
      queryCount += 1;
      if (queryCount === 1) {
        await olderQuery.promise;
        return [{ id: 2, active: true, url: "https://second.test" }];
      }
      return [{ id: 3, active: true, url: "https://third.test" }];
    };

    const olderRefresh = harness.invoke("refreshFromActiveTab");
    harness.clock.advance(1_000);
    const newerRefresh = harness.invoke("refreshFromActiveTab");
    await newerRefresh;
    olderQuery.resolve();
    await olderRefresh;

    expect(harness.state()).toMatchObject({
      tabId: 3,
      hostname: "third.test"
    });
  });
});

describe("getTodayStats messages", () => {
  it("returns the stored local-day bucket", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialStorage: {
        "stats:2026-01-15": { "example.com": 12.5 }
      }
    });

    const response = await harness.events.runtimeMessage.firstListener({
      type: "getTodayStats"
    });

    expect(response).toEqual({
      date: "2026-01-15",
      stats: { "example.com": 12.5 }
    });
  });

  it("returns an empty object when today's bucket is absent", async () => {
    const harness = await settledHarness();

    const response = await harness.events.runtimeMessage.firstListener({
      type: "getTodayStats"
    });

    expect(response).toEqual({
      date: "2026-01-15",
      stats: {}
    });
  });

  it("flushes an in-progress interval and immediately resumes it", async () => {
    const now = localTime(2026, 1, 15, 12);
    const harness = await settledHarness({
      now,
      initialTabs: [{ id: 1, active: true, url: "https://example.com" }]
    });
    harness.clock.advance(2_500);

    const firstResponse = await harness.events.runtimeMessage.firstListener({
      type: "getTodayStats"
    });

    expect(firstResponse.stats).toEqual({ "example.com": 2.5 });
    expect(harness.state()).toMatchObject({
      hostname: "example.com",
      startedAt: harness.clock.now
    });

    harness.clock.advance(1_000);
    const secondResponse = await harness.events.runtimeMessage.firstListener({
      type: "getTodayStats"
    });
    expect(secondResponse.stats).toEqual({ "example.com": 3.5 });
  });

  it.each([null, undefined, {}, { type: "unknown" }])("ignores an unrelated message %j", async (message) => {
    const harness = await settledHarness();

    const response = await harness.events.runtimeMessage.firstListener(message);

    expect(response).toBeUndefined();
    expect(harness.calls.storageGet).toEqual([]);
    expect(harness.calls.storageSet).toEqual([]);
  });

  it("propagates storage failures to the message sender", async () => {
    const harness = await settledHarness();
    const error = new Error("storage unavailable");
    harness.implementations.storageGet = async () => {
      throw error;
    };

    await expect(
      harness.events.runtimeMessage.firstListener({ type: "getTodayStats" })
    ).rejects.toBe(error);
  });
});
