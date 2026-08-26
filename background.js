const IDLE_THRESHOLD_SECONDS = 60;

let current = {
  tabId: null,
  hostname: null,
  startedAt: null,
  windowFocused: true,
  userActive: true
};

function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function hostnameForUrl(url) {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return null;
    return parsedUrl.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

async function addDuration(domain, startedAt, endedAt) {
  if (!domain || !startedAt || endedAt <= startedAt) return;

  // Split the interval at local midnight so time is credited to the correct day.
  let cursor = new Date(startedAt);
  const end = new Date(endedAt);

  while (cursor < end) {
    const nextMidnight = new Date(cursor);
    nextMidnight.setHours(24, 0, 0, 0);
    const chunkEnd = nextMidnight < end ? nextMidnight : end;
    const seconds = Math.max(0, (chunkEnd - cursor) / 1000);
    const key = dayKey(cursor);
    const storageKey = `stats:${key}`;

    const stored = await browser.storage.local.get(storageKey);
    const stats = stored[storageKey] || {};
    stats[domain] = (stats[domain] || 0) + seconds;
    await browser.storage.local.set({ [storageKey]: stats });

    cursor = chunkEnd;
  }
}

async function stopTracking(now = Date.now()) {
  if (current.hostname && current.startedAt) {
    await addDuration(current.hostname, current.startedAt, now);
  }
  current.hostname = null;
  current.startedAt = null;
}

async function startTrackingTab(tab, now = Date.now()) {
  await stopTracking(now);

  current.tabId = tab?.id ?? null;
  if (!tab || !current.windowFocused || !current.userActive) return;

  const hostname = hostnameForUrl(tab.url);
  if (hostname) {
    current.hostname = hostname;
    current.startedAt = now;
  }
}

async function refreshFromActiveTab() {
  const now = Date.now();
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  await startTrackingTab(tabs[0] || null, now);
}

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await browser.tabs.get(tabId);
    await startTrackingTab(tab);
  } catch {
    await stopTracking();
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId !== current.tabId || !tab.active || !changeInfo.url) return;
  await startTrackingTab(tab);
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === current.tabId) {
    await stopTracking();
    current.tabId = null;
  }
});

browser.windows.onFocusChanged.addListener(async (windowId) => {
  const now = Date.now();
  if (windowId === browser.windows.WINDOW_ID_NONE) {
    current.windowFocused = false;
    await stopTracking(now);
    return;
  }

  current.windowFocused = true;
  await refreshFromActiveTab();
});

browser.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);
browser.idle.onStateChanged.addListener(async (state) => {
  const now = Date.now();
  current.userActive = state === "active";

  if (!current.userActive) {
    await stopTracking(now);
  } else if (current.windowFocused) {
    await refreshFromActiveTab();
  }
});

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type === "getTodayStats") {
    // Flush current in-progress interval without stopping it.
    const now = Date.now();
    if (current.hostname && current.startedAt) {
      await addDuration(current.hostname, current.startedAt, now);
      current.startedAt = now;
    }

    const key = `stats:${dayKey()}`;
    const data = await browser.storage.local.get(key);

    return {
      date: dayKey(),
      stats: data[key] || {}
    };
  }
});

browser.runtime.onInstalled.addListener(async () => {
  await refreshFromActiveTab();
});

// Initialize state whenever the background script starts.
refreshFromActiveTab().catch(() => {});
