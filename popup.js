const statsEl = document.getElementById("stats");
const emptyEl = document.getElementById("empty");
const dateEl = document.getElementById("date");
const totalEl = document.getElementById("total");

function formatDuration(totalSeconds) {
  const milliseconds = Math.round(totalSeconds * 1000);
  const seconds = Math.floor(milliseconds / 1000);
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
    .map(([domain, seconds]) => [domain, Number(seconds)])
    .filter(([, seconds]) => Number.isFinite(seconds) && seconds > 0)
    .sort((a, b) => b[1] - a[1]);
  const totalSeconds = rows.reduce((total, [, seconds]) => total + seconds, 0);

  totalEl.textContent = formatDuration(totalSeconds);
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
