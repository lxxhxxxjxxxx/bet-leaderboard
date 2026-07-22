// 시세 조회 → 등락률 계산 → AES-256-GCM 암호화 → data.enc 기록
// 실행: LEADERBOARD_PW=<비번> node build.mjs
// 브라우저 SubtleCrypto와 호환되는 포맷(PBKDF2-SHA256 + AES-GCM).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, "data.enc");
const ITER = 200000;

// name, asset, tick, baseline, currency, basenote, yahooSymbol
const PLAYERS = [
  ["우진", "팔란티어", "PLTR · 나스닥",   130.01, "usd", "2/5 종가",  "PLTR"],
  ["수형", "태광산업", "003240 · 코스피", 922000, "krw", "2/6 종가",  "003240.KS"],
  ["태완", "BNB",     "BNB · 코인",      632.74, "usd", "2/6 21:00", "BNB-USD"],
  ["기태", "네이버",   "035420 · 코스피", 249000, "krw", "2/6 종가",  "035420.KS"],
  ["현정", "로보티즈", "108490 · 코스닥", 273000, "krw", "2/6 종가",  "108490.KQ"],
];

async function fetchPrice(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof p !== "number" || !isFinite(p)) throw new Error("no price");
  return p;
}

function decryptPrev(pw) {
  // 이전 data.enc를 복호화해 직전 가격을 fallback으로 확보 (없거나 실패하면 null)
  try {
    const blob = JSON.parse(fs.readFileSync(OUT, "utf8"));
    const salt = Buffer.from(blob.salt, "base64");
    const iv = Buffer.from(blob.iv, "base64");
    const ctTag = Buffer.from(blob.ct, "base64");
    const tag = ctTag.subarray(ctTag.length - 16);
    const ct = ctTag.subarray(0, ctTag.length - 16);
    const key = crypto.pbkdf2Sync(pw, salt, blob.iter || ITER, 32, "sha256");
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    const pt = Buffer.concat([d.update(ct), d.final()]).toString("utf8");
    return JSON.parse(pt);
  } catch {
    return null;
  }
}

function encrypt(pw, obj) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(pw, salt, ITER, 32, "sha256");
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  const ct = Buffer.concat([enc, c.getAuthTag()]);
  return {
    v: 1, kdf: "PBKDF2-SHA256", iter: ITER,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
  };
}

function stampKST() {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }); // "YYYY-MM-DD HH:MM:SS"
  return s.slice(0, 16) + " KST";
}

async function main() {
  const pw = process.env.LEADERBOARD_PW;
  if (!pw) { console.error("LEADERBOARD_PW 환경변수가 필요합니다."); process.exit(1); }

  const prev = decryptPrev(pw);
  const prevNow = {};
  if (prev?.rows) for (const r of prev.rows) prevNow[r.asset] = r.now;

  const rows = [];
  let failures = 0;
  for (const [name, asset, tick, base, cur, note, sym] of PLAYERS) {
    let now;
    try {
      now = await fetchPrice(sym);
    } catch (e) {
      now = prevNow[asset];               // 실패 시 직전 값 유지
      failures++;
      console.error(`fetch fail ${asset}(${sym}): ${e.message} -> keep ${now ?? "N/A"}`);
    }
    if (now == null) now = base;          // 직전값도 없으면 기준가로 (등락률 0)
    const pct = (now - base) / base * 100;
    rows.push({ name, asset, tick, base, now, cur, note, pct });
  }
  rows.sort((a, b) => b.pct - a.pct);

  const payload = { stamp: stampKST(), rows };
  fs.writeFileSync(OUT, JSON.stringify(encrypt(pw, payload)));
  console.log(`wrote ${OUT} | ${payload.stamp} | failures=${failures}`);
  for (const r of rows) console.log(`  ${r.name} ${r.asset}: ${r.now} (${r.pct.toFixed(2)}%)`);
}

main();
