// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const popupHtml = readFileSync(resolve(process.cwd(), "popup.html"), "utf8");

function resetPopupDocument() {
  const parsed = new DOMParser().parseFromString(popupHtml, "text/html");

  document.documentElement.lang = parsed.documentElement.lang;
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
}

async function loadPopup(response) {
  const sendMessage = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("browser", { runtime: { sendMessage } });

  await import("../popup.js");
  await vi.waitFor(() => {
    expect(document.getElementById("date").textContent).toBe(String(response.date));
  });

  return { sendMessage };
}

function renderedRows() {
  return [...document.querySelectorAll("#stats .row")].map((row) => ({
    domain: row.querySelector(".domain")?.textContent,
    time: row.querySelector(".time")?.textContent,
  }));
}

describe("popup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    resetPopupDocument();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requests today's statistics and renders the empty state", async () => {
    document.getElementById("stats").append(document.createElement("span"));

    const { sendMessage } = await loadPopup({
      date: "2026-09-01",
      stats: {},
    });

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({ type: "getTodayStats" });
    expect(document.getElementById("date").textContent).toBe("2026-09-01");
    expect(document.getElementById("total").textContent).toBe("0 s");
    expect(renderedRows()).toEqual([]);
    expect(document.getElementById("stats").children).toHaveLength(0);
    expect(document.getElementById("empty").hidden).toBe(false);
  });

  it("filters invalid durations, sorts valid rows, and totals only rendered entries", async () => {
    await loadPopup({
      date: "2026-09-01",
      stats: {
        "invalid-text.example": "not a number",
        "zero.example": 0,
        "negative.example": -2,
        "nan.example": Number.NaN,
        "infinite.example": Number.POSITIVE_INFINITY,
        "empty-string.example": "",
        "numeric-string.example": "120",
        "tie-one.example": 120,
        "hour.example": 3661.9,
        "tie-two.example": 120,
        "minute.example": 61.234,
        "subsecond.example": 0.2,
      },
    });

    expect(renderedRows()).toEqual([
      { domain: "hour.example", time: "1 h 01 min" },
      { domain: "numeric-string.example", time: "2 min 00 s" },
      { domain: "tie-one.example", time: "2 min 00 s" },
      { domain: "tie-two.example", time: "2 min 00 s" },
      { domain: "minute.example", time: "1 min 01 s" },
      { domain: "subsecond.example", time: "0 s" },
    ]);
    expect(document.getElementById("total").textContent).toBe("1 h 08 min");
    expect(document.getElementById("empty").hidden).toBe(true);
  });

  it("computes the total from raw fractions rather than displayed row values", async () => {
    await loadPopup({
      date: "2026-09-01",
      stats: {
        "first.example": 0.6,
        "second.example": 0.6,
      },
    });

    expect(renderedRows()).toEqual([
      { domain: "first.example", time: "0 s" },
      { domain: "second.example", time: "0 s" },
    ]);
    expect(document.getElementById("total").textContent).toBe("1 s");
  });

  it.each([
    [0.0001, "0 s"],
    [0.9994, "0 s"],
    [0.9995, "1 s"],
    [59, "59 s"],
    [59.9994, "59 s"],
    [59.9995, "1 min 00 s"],
    [60, "1 min 00 s"],
    [61, "1 min 01 s"],
    [3599.9994, "59 min 59 s"],
    [3599.9995, "1 h 00 min"],
    [3600, "1 h 00 min"],
    [3661, "1 h 01 min"],
    [90061, "25 h 01 min"],
  ])("formats %s seconds as %s", async (seconds, expected) => {
    await loadPopup({
      date: "2026-09-01",
      stats: { "boundary.example": seconds },
    });

    expect(renderedRows()).toEqual([
      { domain: "boundary.example", time: expected },
    ]);
    expect(document.getElementById("total").textContent).toBe(expected);
  });

  it("renders untrusted dates and domains as text instead of markup", async () => {
    const date = '</p><script>window.__popupXssExecuted = true</script>';
    const domain = '<img src=x onerror="window.__popupXssExecuted = true">';

    await loadPopup({ date, stats: { [domain]: 1 } });

    expect(document.getElementById("date").textContent).toBe(date);
    expect(renderedRows()).toEqual([{ domain, time: "1 s" }]);
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(document.querySelectorAll("script")).toHaveLength(1);
    expect(window.__popupXssExecuted).toBeUndefined();
  });
});
