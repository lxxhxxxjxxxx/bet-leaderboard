// Deno Deploy — 5종목 라이브 시세 프록시 (CORS 허용)
//  · 국내 3종목(태광산업·네이버·로보티즈): 네이버 실시간(토스와 동일 실시간 KRX, delayTime=0)
//    → 실패 시 야후로 자동 폴백
//  · 팔란티어(PLTR)·BNB: 야후
// dash.deno.com → 이 프로젝트 Playground → 기존 코드 지우고 붙여넣기 → Save & Deploy.
// 시세는 공개 정보(비밀 아님). 이름/기준가 등 민감 정보는 다루지 않습니다.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

async function yahoo(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error("yahoo " + r.status);
  const j = await r.json();
  const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof p !== "number" || !isFinite(p)) throw new Error("yahoo noprice");
  return p;
}

async function naver(code) {
  const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/" } });
  if (!r.ok) throw new Error("naver " + r.status);
  const j = await r.json();
  const n = Number(String(j?.datas?.[0]?.closePrice ?? "").replace(/,/g, ""));
  if (!isFinite(n) || n <= 0) throw new Error("naver parse");
  return n;
}

// 페이지가 요청하는 심볼 키 → 조회 전략 (국내는 네이버 실시간, 실패 시 야후 폴백)
const JOBS = {
  "PLTR":      () => yahoo("PLTR"),
  "BNB-USD":   () => yahoo("BNB-USD"),
  "003240.KS": () => naver("003240").catch(() => yahoo("003240.KS")),
  "035420.KS": () => naver("035420").catch(() => yahoo("035420.KS")),
  "108490.KQ": () => naver("108490").catch(() => yahoo("108490.KQ")),
};

let cache = { ts: 0, body: null };
const TTL = 15000;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const now = Date.now();
  const headers = { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=15" };
  if (cache.body && now - cache.ts < TTL) return new Response(cache.body, { headers });

  const prices = {};
  await Promise.all(Object.entries(JOBS).map(async ([sym, fn]) => {
    try { prices[sym] = await fn(); } catch { prices[sym] = null; } // 실패 종목은 null → 페이지가 직전값 유지
  }));

  const body = JSON.stringify({ prices, ts: now });
  cache = { ts: now, body };
  return new Response(body, { headers });
});
