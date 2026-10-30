const memory = () => {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    get length() {
      return store.size;
    },
  };
};

function element() {
  return {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [],
    childNodes: [],
    textContent: "",
    innerHTML: "",
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    appendChild(child) { return child; },
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
    focus() {},
    click() {},
  };
}

if (!globalThis.localStorage) globalThis.localStorage = memory();
if (!globalThis.sessionStorage) globalThis.sessionStorage = memory();

if (!globalThis.document) {
  const documentElement = element();
  globalThis.document = {
    title: "",
    documentElement,
    head: element(),
    body: element(),
    readyState: "complete",
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => element(),
    addEventListener() {},
    removeEventListener() {},
  };
}

if (!globalThis.location || typeof globalThis.location.href !== "string") {
  globalThis.location = {
    href: "https://www.veridrop.cn/",
    origin: "https://www.veridrop.cn",
    protocol: "https:",
    host: "www.veridrop.cn",
    hostname: "www.veridrop.cn",
    pathname: "/",
    search: "",
    hash: "",
    assign() {},
    replace() {},
  };
}
if (!globalThis.navigator) globalThis.navigator = { userAgent: "ssr", clipboard: { writeText() { return Promise.resolve(); } } };
if (!globalThis.matchMedia) globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = () => 0;
if (!globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame = () => {};
globalThis.scrollTo = globalThis.scrollTo || (() => {});
globalThis.innerWidth = globalThis.innerWidth || 1280;
globalThis.innerHeight = globalThis.innerHeight || 800;
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
