// Deno Deploy — 5종목 라이브 시세 프록시 (Yahoo Finance → JSON, CORS 허용)
// dash.deno.com → GitHub 로그인 → Playground에 이 코드 붙여넣고 Save & Deploy.
// 시세는 공개 정보(비밀 아님). 이름/기준가 등 민감 정보는 다루지 않습니다.

const SYMBOLS = ["PLTR", "003240.KS", "BNB-USD", "035420.KS", "108490.KQ"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// 15초 캐시: 여러 명이 동시에 눌러도 야후를 과하게 부르지 않고, 다들 같은 최신값을 봄
let cache = { ts: 0, body: null };
const TTL = 15000;

async function yahoo(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error("http " + r.status);
  const j = await r.json();
  const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof p !== "number" || !isFinite(p)) throw new Error("no price");
  return p;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const now = Date.now();
  const headers = { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=15" };

  if (cache.body && now - cache.ts < TTL) {
    return new Response(cache.body, { headers });
  }

  const prices = {};
  await Promise.all(SYMBOLS.map(async (s) => {
    try { prices[s] = await yahoo(s); } catch { prices[s] = null; } // 실패 종목은 null → 페이지가 직전값 유지
  }));

  const body = JSON.stringify({ prices, ts: now });
  cache = { ts: now, body };
  return new Response(body, { headers });
});
