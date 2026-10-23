import { qrMatrix } from "./qr.js";

const W = 440;
const PAD = 26;
const FONT = '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const INK = "#1d1d1f";
const MUTED = "#76767c";
const FAINT = "#8e8e93";
const OLIVE = "#65A30D";
const AMBER = "#b45309";
const RED = "#e23d3d";
const TILE = "#f4f5f7";
const LINE = "#ececee";

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clip(ctx, text, max) {
  const value = String(text || "");
  if (ctx.measureText(value).width <= max) return value;
  let out = value;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > max) out = out.slice(0, -1);
  return `${out}…`;
}

function clipMiddle(ctx, text, max) {
  const value = String(text || "");
  if (ctx.measureText(value).width <= max) return value;
  let keep = value.length;
  while (keep > 4) {
    const head = Math.ceil(keep / 2);
    const tail = Math.floor(keep / 2);
    const next = `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
    if (ctx.measureText(next).width <= max) return next;
    keep -= 1;
  }
  return clip(ctx, value, max);
}

function rowKind(word) {
  if (word === "通过") return "pass";
  if (word === "留意") return "warn";
  if (word === "未通过" || word === "没测成") return "bad";
  return "mute";
}

function wordColor(kind) {
  if (kind === "pass") return OLIVE;
  if (kind === "warn") return AMBER;
  if (kind === "bad") return RED;
  return FAINT;
}

function verdictColor(verdict) {
  if (verdict === "没测成") return RED;
  if (verdict === "检测中") return AMBER;
  return OLIVE;
}

function drawShield(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.08);
  ctx.lineTo(s * 0.9, s * 0.26);
  ctx.lineTo(s * 0.9, s * 0.5);
  ctx.bezierCurveTo(s * 0.9, s * 0.74, s * 0.7, s * 0.88, s * 0.5, s * 0.96);
  ctx.bezierCurveTo(s * 0.3, s * 0.88, s * 0.1, s * 0.74, s * 0.1, s * 0.5);
  ctx.lineTo(s * 0.1, s * 0.26);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawMark(ctx, cx, cy, kind) {
  if (kind === "mute") {
    ctx.beginPath();
    ctx.strokeStyle = "#d0d0d4";
    ctx.lineWidth = 1.4;
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = FAINT;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.moveTo(cx - 3, cy);
    ctx.lineTo(cx + 3, cy);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.fillStyle = wordColor(kind);
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (kind === "pass") {
    ctx.moveTo(cx - 3.2, cy + 0.2);
    ctx.lineTo(cx - 1, cy + 2.5);
    ctx.lineTo(cx + 3.5, cy - 2.5);
  } else if (kind === "warn") {
    ctx.moveTo(cx, cy - 3.2);
    ctx.lineTo(cx, cy + 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = "#fff";
    ctx.arc(cx, cy + 2.7, 1, 0, Math.PI * 2);
    ctx.fill();
    return;
  } else {
    ctx.moveTo(cx - 2.5, cy - 2.5);
    ctx.lineTo(cx + 2.5, cy + 2.5);
    ctx.moveTo(cx + 2.5, cy - 2.5);
    ctx.lineTo(cx - 2.5, cy + 2.5);
  }
  ctx.stroke();
}

function drawQr(ctx, matrix, x, y, modulePx) {
  const quiet = 4;
  ctx.fillStyle = "#fff";
  ctx.fillRect(x, y, (matrix.size + quiet * 2) * modulePx, (matrix.size + quiet * 2) * modulePx);
  ctx.fillStyle = "#111";
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.modules[row * matrix.size + col]) continue;
      ctx.fillRect(x + (col + quiet) * modulePx, y + (row + quiet) * modulePx, modulePx, modulePx);
    }
  }
}

function posterMetrics(info) {
  const rows = info.rows || [];
  const half = Math.ceil(rows.length / 2) || 1;
  const qr = info.url ? qrMatrix(info.url) : null;
  const modulePx = 3;
  const qrSize = qr ? (qr.size + 8) * modulePx : 0;
  const rowH = 28;
  const kpiH = 74;
  const ringR = 62;
  const footerH = Math.max(76, qr ? qrSize + 22 : 40);
  const headerY = 34;
  const ringY = headerY + 22 + ringR;
  const verdictY = ringY + ringR + 26;
  const hostY = verdictY + 34;
  const urlY = hostY + 22;
  const kpiY = urlY + 26;
  const rowsY = kpiY + kpiH + 20;
  const lineY = rowsY + half * rowH + 8;
  const footY = lineY + 18;
  const height = footY + footerH + 18;
  return { rows, half, qr, modulePx, qrSize, rowH, kpiH, ringR, headerY, ringY, verdictY, hostY, urlY, kpiY, rowsY, lineY, footY, height };
}

export function renderBasicPoster(canvas, info, scale = 2) {
  const box = posterMetrics(info);
  const pixel = Math.max(1, scale);
  canvas.width = Math.round(W * pixel);
  canvas.height = Math.round(box.height * pixel);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(pixel, 0, 0, pixel, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, box.height);
  const wash = ctx.createLinearGradient(0, 0, 0, 168);
  wash.addColorStop(0, "#f7fee7");
  wash.addColorStop(1, "#ffffff");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, 168);

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `700 22px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText("Veri", PAD, box.headerY);
  const veriW = ctx.measureText("Veri").width;
  ctx.fillStyle = OLIVE;
  ctx.fillText("Drop", PAD + veriW, box.headerY);
  ctx.font = `500 12px ${FONT}`;
  const pill = "基础测试";
  const pillW = ctx.measureText(pill).width + 22;
  const pillH = 26;
  const pillX = W - PAD - pillW;
  roundRect(ctx, pillX, box.headerY - pillH / 2, pillW, pillH, 13);
  ctx.fillStyle = "#f4f5f7";
  ctx.fill();
  ctx.fillStyle = MUTED;
  ctx.textAlign = "center";
  ctx.fillText(pill, pillX + pillW / 2, box.headerY + 0.5);

  const cx = W / 2;
  const ringY = box.ringY;
  ctx.beginPath();
  ctx.strokeStyle = "#ececf1";
  ctx.lineWidth = 12;
  ctx.arc(cx, ringY, box.ringR, 0, Math.PI * 2);
  ctx.stroke();
  const sweep = info.running ? 0.16 : (info.score == null ? 0 : Math.max(0, Math.min(100, info.score)) / 100);
  if (sweep > 0) {
    const ring = ctx.createLinearGradient(cx - box.ringR, ringY - box.ringR, cx + box.ringR, ringY + box.ringR);
    ring.addColorStop(0, "#bef264");
    ring.addColorStop(1, "#4d7c0f");
    ctx.beginPath();
    ctx.strokeStyle = ring;
    ctx.lineWidth = 12;
    ctx.lineCap = sweep >= 0.999 ? "butt" : "round";
    const start = -Math.PI / 2;
    ctx.arc(cx, ringY, box.ringR, start, start + Math.PI * 2 * sweep);
    ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  ctx.font = info.score == null ? `500 34px ${FONT}` : `700 48px ${FONT}`;
  ctx.fillText(info.score == null ? "—" : String(info.score), cx, ringY - 6);
  ctx.font = `500 13px ${FONT}`;
  ctx.fillStyle = FAINT;
  ctx.fillText("/ 100", cx, ringY + 24);

  const color = verdictColor(info.verdict);
  ctx.font = `700 18px ${FONT}`;
  const verdict = info.verdict || "";
  const verdictW = ctx.measureText(verdict).width;
  const shield = 18;
  const group = shield + 8 + verdictW;
  drawShield(ctx, cx - group / 2, box.verdictY - shield / 2, shield, color);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.fillText(verdict, cx - group / 2 + shield + 8, box.verdictY);

  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText(clip(ctx, info.host || "—", W - PAD * 2), cx, box.hostY);
  ctx.font = `400 13px ${FONT}`;
  ctx.fillStyle = FAINT;
  ctx.fillText(clipMiddle(ctx, info.base || "", W - PAD * 2), cx, box.urlY);

  const kpis = (info.kpis || []).slice(0, 4);
  const gap = 8;
  const tileW = (W - PAD * 2 - gap * 3) / 4;
  kpis.forEach((item, index) => {
    const x = PAD + index * (tileW + gap);
    roundRect(ctx, x, box.kpiY, tileW, box.kpiH, 14);
    ctx.fillStyle = TILE;
    ctx.fill();
    ctx.textAlign = "center";
    ctx.font = `400 12px ${FONT}`;
    ctx.fillStyle = FAINT;
    ctx.fillText(clip(ctx, item[0], tileW - 8), x + tileW / 2, box.kpiY + 24);
    ctx.font = `700 18px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(clip(ctx, item[1] || "—", tileW - 6), x + tileW / 2, box.kpiY + 48);
  });

  const colGap = 20;
  const colW = (W - PAD * 2 - colGap) / 2;
  for (let i = 0; i < box.half; i += 1) {
    [box.rows[i], box.rows[i + box.half]].forEach((row, side) => {
      if (!row) return;
      const x = PAD + side * (colW + colGap);
      const cy = box.rowsY + i * box.rowH + box.rowH / 2;
      const kind = rowKind(row.word);
      drawMark(ctx, x + 7, cy, kind);
      ctx.font = `600 13px ${FONT}`;
      ctx.textAlign = "right";
      const word = row.word || "…";
      const wordW = ctx.measureText(word).width;
      ctx.fillStyle = wordColor(kind);
      ctx.fillText(word, x + colW, cy);
      ctx.textAlign = "left";
      ctx.font = `500 13px ${FONT}`;
      ctx.fillStyle = INK;
      ctx.fillText(clip(ctx, row.label, colW - 22 - wordW - 10), x + 20, cy);
    });
  }

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, box.lineY);
  ctx.lineTo(W - PAD, box.lineY);
  ctx.stroke();

  const textX = PAD;
  const textMax = (box.qr ? W - box.qrSize - 36 : W - PAD) - textX;
  const lines = [
    ["检测模型", info.model || "—"],
    ["检测时间", info.time || "—"],
  ];
  ctx.textAlign = "left";
  lines.forEach((line, index) => {
    const ly = box.footY + 10 + index * 22;
    ctx.font = `400 12px ${FONT}`;
    ctx.fillStyle = FAINT;
    ctx.fillText(line[0], textX, ly);
    const labelW = ctx.measureText(line[0]).width;
    ctx.font = `600 13px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(clip(ctx, line[1], textMax - labelW - 10), textX + labelW + 8, ly);
  });
  ctx.font = `400 12px ${FONT}`;
  ctx.fillStyle = FAINT;
  ctx.fillText("www.veridrop.cn", textX, box.footY + 10 + 44);

  if (box.qr) {
    const qx = W - PAD - box.qrSize;
    drawQr(ctx, box.qr, qx, box.footY, box.modulePx);
    ctx.textAlign = "center";
    ctx.font = `400 11px ${FONT}`;
    ctx.fillStyle = FAINT;
    ctx.fillText("扫码打开报告", qx + box.qrSize / 2, box.footY + box.qrSize + 12);
  } else if (info.url) {
    ctx.textAlign = "left";
    ctx.font = `400 11px ${FONT}`;
    ctx.fillStyle = FAINT;
    ctx.fillText(clipMiddle(ctx, info.url, W - PAD * 2), PAD, box.footY + 72);
  }

  return { width: W, height: box.height };
}
