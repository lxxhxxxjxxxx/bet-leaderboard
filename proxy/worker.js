// Cloudflare Worker — 5종목 라이브 시세 프록시 (Yahoo Finance → JSON, CORS 허용)
// 대시보드에 이 코드를 붙여넣고 Deploy 하면 됩니다.
// 시세는 공개 정보라 비밀이 아니며, 이름/기준가 등 민감 정보는 다루지 않습니다.

const SYMBOLS = ["PLTR", "003240.KS", "BNB-USD", "035420.KS", "108490.KQ"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

async function yahoo(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  // cf.cacheTtl: 같은 엣지에서 15초간 야후 응답을 공유 → 모든 방문자가 같은 최신값, 야후 부담↓
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cf: { cacheTtl: 15 } });
  if (!r.ok) throw new Error("http " + r.status);
  const j = await r.json();
  const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof p !== "number" || !isFinite(p)) throw new Error("no price");
  return p;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const prices = {};
    await Promise.all(SYMBOLS.map(async (s) => {
      try { prices[s] = await yahoo(s); } catch { prices[s] = null; } // 실패 종목은 null → 페이지가 직전값 유지
    }));
    return new Response(JSON.stringify({ prices, ts: Date.now() }), {
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=15" },
    });
  },
};
