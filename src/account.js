const ACCOUNTS = "okk-accounts";
const USER = "okk-user";
const EMAIL = "okk-email";
const AVATAR = "okk-avatar";
const SUBS = "okk-submissions";

export function readAccounts() {
  try {
    const raw = JSON.parse(localStorage.getItem(ACCOUNTS) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function writeAccounts(list) {
  localStorage.setItem(ACCOUNTS, JSON.stringify(list));
}

export function readSession() {
  return {
    name: localStorage.getItem(USER) || "",
    email: localStorage.getItem(EMAIL) || "",
  };
}

export function writeSession(name, email) {
  localStorage.setItem(USER, name);
  if (email) localStorage.setItem(EMAIL, email);
  else localStorage.removeItem(EMAIL);
}

export function readAvatar() {
  return localStorage.getItem(AVATAR) || "";
}

export function writeAvatar(dataUrl) {
  if (dataUrl) localStorage.setItem(AVATAR, dataUrl);
  else localStorage.removeItem(AVATAR);
}

export function clearSession() {
  localStorage.removeItem(USER);
  localStorage.removeItem(EMAIL);
  localStorage.removeItem(AVATAR);
}

export function fitAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || "").startsWith("image/")) {
      reject(new Error("请选择图片"));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error("图片太大，请换一张 8MB 以内的"));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 192;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("这张图片打不开"));
    };
    img.src = url;
  });
}

export function readSubmissions() {
  try {
    const raw = JSON.parse(localStorage.getItem(SUBS) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function addSubmission(entry) {
  const list = readSubmissions();
  list.unshift({
    id: `sub-${Date.now().toString(36)}`,
    name: entry.name,
    url: entry.url,
    note: entry.note,
    at: new Date().toISOString(),
  });
  localStorage.setItem(SUBS, JSON.stringify(list));
  return list;
}
