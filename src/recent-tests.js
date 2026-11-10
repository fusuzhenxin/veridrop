export function mergeRecentTests(archived, reports, stations, heading) {
  const entries = new Map(archived.map((item) => [item.slug || item.station, item]));
  const hostKey = (host) => String(host || "").toLowerCase().replace(/^www\./, "");
  for (const report of Array.isArray(reports) ? reports : []) {
    if (!/^basic-[a-z0-9]{6,16}$/.test(report?.id || "") || typeof report.score !== "number" || !Number.isFinite(report.score) || report.score < 0 || report.score > 100) continue;
    const at = Date.parse(report.at);
    if (!Number.isFinite(at)) continue;
    const station = stations.find((item) => report.stationId != null && String(item.verdId) === String(report.stationId))
      || stations.find((item) => hostKey(item.host) === hostKey(report.host));
    if (!station) continue;
    const previous = entries.get(station.slug);
    if (previous && previous.at >= at) continue;
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
    entries.set(station.slug, {
      slug: station.slug, station: heading(station), img: station.img || "",
      model: report.model || report.channel || "基础测试", score: report.score, at,
      date: `${parts.find((part) => part.type === "month").value}-${parts.find((part) => part.type === "day").value}`,
      href: `/b/${report.id}`,
    });
  }
  return [...entries.values()].sort((a, b) => b.at - a.at);
}
