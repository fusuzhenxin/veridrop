// Add attribution only at website/register links; stored station and API URLs stay intact.
export function stationHref(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return value;
  let url;
  try { url = new URL(value); } catch { return value; }
  if (/(^|\.)veridrop\.cn$/i.test(url.hostname) || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname)) return value;
  if (/^\/(?:api|v\d+(?:beta\d*)?)(?:\/|$)/i.test(url.pathname)) return value;
  if ([...url.searchParams.keys()].some(key => /^(?:sign|sig|signature|x-amz-signature|x-goog-signature|policy|key-pair-id)$/i.test(key))) return value;

  const hashAt = value.indexOf("#");
  const fragment = hashAt < 0 ? "" : value.slice(hashAt);
  const address = hashAt < 0 ? value : value.slice(0, hashAt);
  const queryAt = address.indexOf("?");
  const base = queryAt < 0 ? address : address.slice(0, queryAt);
  const params = queryAt < 0 ? [] : address.slice(queryAt + 1).split("&").filter(Boolean);
  // Keep referral codes and other query values byte-for-byte, including their encoding.
  const kept = params.filter(param => {
    try { return decodeURIComponent(param.split("=", 1)[0].replace(/\+/g, " ")).toLowerCase() !== "utm_source"; }
    catch { return true; }
  });
  return `${base}?${[...kept, "utm_source=veridrop.cn"].join("&")}${fragment}`;
}

export function listedStationHref(value, stationSites) {
  try {
    const host = new URL(value).hostname.replace(/^www\./i, "");
    const listed = stationSites.some(site => {
      try { return new URL(site).hostname.replace(/^www\./i, "") === host; }
      catch { return false; }
    });
    return listed ? stationHref(value) : value;
  } catch { return value; }
}
