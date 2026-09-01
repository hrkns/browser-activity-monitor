import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, test } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(projectRoot, "manifest.json");

let manifest;

function packagedFile(relativePath) {
  expect(relativePath).toEqual(expect.any(String));
  expect(relativePath).not.toMatch(/^[a-z][a-z\d+.-]*:/i);

  const absolutePath = resolve(projectRoot, relativePath);
  const pathFromRoot = relative(projectRoot, absolutePath);
  expect(isAbsolute(pathFromRoot)).toBe(false);
  expect(pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)).toBe(false);
  expect(statSync(absolutePath).isFile()).toBe(true);

  return absolutePath;
}

beforeAll(() => {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
});

describe("extension package contract", () => {
  test("defines a versioned Firefox Manifest V2 extension", () => {
    expect(manifest).toMatchObject({
      manifest_version: 2,
      name: "Browser Activity Monitor",
      background: {
        persistent: true
      },
      browser_action: {
        default_popup: "popup.html"
      }
    });
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.version_name).toContain(manifest.version);
    expect(manifest.browser_specific_settings?.gecko?.id).toMatch(/^[^@\s]+@[^@\s]+$/);
    expect(manifest.browser_specific_settings.gecko.data_collection_permissions).toEqual({
      required: ["none"]
    });
  });

  test("requests only the permissions required by the tracker", () => {
    expect([...manifest.permissions].sort()).toEqual(["idle", "storage", "tabs"]);
  });

  test("references background and popup files inside the package", () => {
    expect(manifest.background.scripts).toEqual(["background.js"]);

    for (const script of manifest.background.scripts) packagedFile(script);
    packagedFile(manifest.browser_action.default_popup);
  });

  test("ships every local stylesheet and script referenced by the popup", () => {
    const popupPath = packagedFile(manifest.browser_action.default_popup);
    const popup = new JSDOM(readFileSync(popupPath, "utf8"));
    const { document } = popup.window;

    expect(document.documentElement.lang).toBe("en");
    expect(document.querySelector("meta[charset]")?.getAttribute("charset")).toBe("utf-8");
    expect(document.querySelector('meta[name="viewport"]')).not.toBeNull();

    const stylesheets = [...document.querySelectorAll('link[rel="stylesheet"][href]')]
      .map((element) => element.getAttribute("href"));
    const scripts = [...document.querySelectorAll("script[src]")]
      .map((element) => element.getAttribute("src"));

    expect(stylesheets).toEqual(["popup.css"]);
    expect(scripts).toEqual(["popup.js"]);
    for (const asset of [...stylesheets, ...scripts]) packagedFile(asset);

    popup.window.close();
  });
});
