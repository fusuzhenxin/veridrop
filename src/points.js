const KEY = "okk-points-state";

export function shanghaiDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

export function readPoints() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      balance: Number(raw.balance) || 0,
      ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
      done: raw.done || {},
      nick: raw.nick || "",
    };
  } catch {
    return { balance: 0, ledger: [], done: {}, nick: "" };
  }
}

function write(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new Event("okk-points"));
  return state;
}

export function saveNick(nick) {
  const state = readPoints();
  state.nick = nick.trim();
  return write(state);
}

export function replacePoints(remote) {
  const day = shanghaiDay();
  const done = {};
  for (const id of ["checkin", "like", "review", "detect"]) {
    if (remote?.done?.[id]) done[`${id}:${day}`] = true;
  }
  for (const id of ["first-detect", "favorite", "profile"]) {
    if (remote?.done?.[id]) done[id] = true;
  }
  const state = {
    balance: Number(remote?.balance) || 0,
    ledger: Array.isArray(remote?.ledger) ? remote.ledger : [],
    done,
    nick: readPoints().nick,
  };
  return write(state);
}

export function markDone(id, scope) {
  const state = readPoints();
  const token = scope === "day" ? `${id}:${shanghaiDay()}` : id;
  if (state.done[token]) return state;
  state.done[token] = true;
  return write(state);
}

export function isDone(id, scope) {
  const token = scope === "day" ? `${id}:${shanghaiDay()}` : id;
  return Boolean(readPoints().done[token]);
}

export function grant(id, amount, reason, scope) {
  const state = readPoints();
  const token = scope ? (scope === "day" ? `${id}:${shanghaiDay()}` : id) : "";
  if (token && state.done[token]) return { state, added: 0 };
  if (token) state.done[token] = true;
  state.balance += amount;
  queueMicrotask(() => window.dispatchEvent(new CustomEvent("okk-points-sync", { detail: { id } })));
  state.ledger.unshift({
    id,
    reason,
    amount,
    at: new Date().toISOString(),
  });
  return { state: write(state), added: amount };
}
