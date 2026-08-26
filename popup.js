const statsEl = document.getElementById("stats");
const emptyEl = document.getElementById("empty");
const dateEl = document.getElementById("date");

function formatDuration(totalSeconds) {
  const seconds = Math.floor(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}

async function render() {
  const data = await browser.runtime.sendMessage({ type: "getTodayStats" });
  dateEl.textContent = data.date;

  const rows = Object.entries(data.stats)
    .filter(([, seconds]) => seconds > 0)
    .sort((a, b) => b[1] - a[1]);

  statsEl.replaceChildren();
  emptyEl.hidden = rows.length > 0;

  for (const [domain, seconds] of rows) {
    const row = document.createElement("div");
    row.className = "row";

    const domainEl = document.createElement("div");
    domainEl.className = "domain";
    domainEl.textContent = domain;

    const timeEl = document.createElement("div");
    timeEl.className = "time";
    timeEl.textContent = formatDuration(seconds);

    row.append(domainEl, timeEl);
    statsEl.append(row);
  }
}

render();
