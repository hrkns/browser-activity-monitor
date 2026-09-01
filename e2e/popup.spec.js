import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const popupUrl = pathToFileURL(resolve(projectRoot, "popup.html")).href;

async function openPopup(page, response) {
  await page.addInitScript((today) => {
    Object.defineProperty(globalThis, "browser", {
      configurable: true,
      value: {
        runtime: {
          sendMessage: async (message) => {
            globalThis.__popupRequest = message;
            return today;
          }
        }
      }
    });
  }, response);

  await page.goto(popupUrl);
}

test.describe("popup", () => {
  test("requests today's data and renders the empty state", async ({ page }) => {
    await openPopup(page, { date: "2026-08-31", stats: {} });

    await expect(page.getByRole("heading", { name: "Browser Activity Monitor" })).toBeVisible();
    await expect(page.locator("#date")).toHaveText("2026-08-31");
    await expect(page.locator("#total")).toHaveText("0 s");
    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#stats .row")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => globalThis.__popupRequest)).toEqual({
      type: "getTodayStats"
    });
  });

  test("filters invalid entries, ranks domains, and formats durations and the total", async ({ page }) => {
    await openPopup(page, {
      date: "2026-08-31",
      stats: {
        "rounded.example": 59.9996,
        "invalid.example": "not-a-number",
        "hour.example": 3661.4,
        "negative.example": -3,
        "numeric-string.example": "61.9",
        "under-hour.example": 125.9994,
        "infinite.example": "Infinity",
        "zero.example": 0
      }
    });

    await expect(page.locator("#stats .domain")).toHaveText([
      "hour.example",
      "under-hour.example",
      "numeric-string.example",
      "rounded.example"
    ]);
    await expect(page.locator("#stats .time")).toHaveText([
      "1 h 01 min",
      "2 min 05 s",
      "1 min 01 s",
      "1 min 00 s"
    ]);
    await expect(page.locator("#total")).toHaveText("1 h 05 min");
    await expect(page.locator("#empty")).toBeHidden();
  });

  test("renders an untrusted hostname as text rather than markup", async ({ page }) => {
    const untrustedDomain = '<img src=x onerror="globalThis.__domainMarkupRan = true">';
    await openPopup(page, {
      date: "2026-08-31",
      stats: { [untrustedDomain]: 10 }
    });

    await expect(page.locator("#stats .domain")).toHaveText(untrustedDomain);
    await expect(page.locator("#stats img")).toHaveCount(0);
    expect(await page.evaluate(() => globalThis.__domainMarkupRan)).toBeUndefined();
  });

  test("loads the packaged stylesheet in a narrow popup viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await openPopup(page, {
      date: "2026-08-31",
      stats: { "a-very-long-domain-name-that-must-not-expand-the-popup.example": 15 }
    });

    await expect(page.locator("#stats .row")).toBeVisible();
    expect(await page.locator("body").evaluate((element) => getComputedStyle(element).minWidth)).toBe("320px");
    expect(await page.locator("main").evaluate((element) => getComputedStyle(element).padding)).toBe("14px");
    expect(await page.locator(".daily-total").evaluate((element) => getComputedStyle(element).display)).toBe("flex");
    expect(await page.locator("#stats .row").evaluate((element) => getComputedStyle(element).display)).toBe("grid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});
