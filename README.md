# Browser Activity Monitor for Firefox

A WebExtension that tracks how much time you spend on every website each day.

## What counts as activity

- The tab must be active.
- The Firefox window must be focused.
- The user must be active; tracking stops after 60 seconds of inactivity.
- Each hostname is recorded separately; `www.` is removed to avoid duplicates.
- Only HTTP and HTTPS pages are tracked, not internal pages such as `about:`.
- Intervals that cross midnight are split between the two days.

## Temporary installation

1. Open `about:debugging` in Firefox.
2. Select **This Firefox**.
3. Click **Load Temporary Add-on**.
4. Select `manifest.json` from this directory.
5. Click the add-on's toolbar icon to see today's ranking.

Temporary extensions are removed when Firefox restarts. For permanent installation, the add-on must be signed and distributed according to the Firefox Add-ons requirements.

## Data

Data is stored locally in `browser.storage.local` using date-based keys (`stats:YYYY-MM-DD`). Previous days are not deleted, although the popup currently shows only the current day. This keeps the data ready for a future history view.
