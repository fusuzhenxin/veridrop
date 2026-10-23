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
  state.ledger.unshift({
    id,
    reason,
    amount,
    at: new Date().toISOString(),
  });
  return { state: write(state), added: amount };
}
