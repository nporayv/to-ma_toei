// 運賃の回帰テスト。 node tools/test_fares.js で実行する。
//
// ★このファイルの目的★
//   このサービスの実害は一方向に出る。実際より安く案内すると、利用者が改札で足りない思いをする。
//   そこで「実際の運賃」と突き合わせ、安く出ている区間を機械的に見つけられるようにしておく。
//
//   運賃の誤差には2つの原因があり、混ざると原因を取り違える(実際に一度取り違えた)。
//     ・距離推定の誤差 … 駅の緯度経度から営業キロを推定しているためのずれ
//     ・運賃表の誤り   … 改定の取りこぼし、長距離帯の未整備
//   どちらが効いているか分かるよう、距離と運賃を分けて表示する。
//
// ★合否の考え方★
//   実際より「高い」のは安全側なので許容する。実際より「安い」行が出たら不合格。
//   10円単位の一致は目標にしない。各社の公式運賃検索と精度を競うものではない。
//
// ★検証データの足し方★
//   CASES に1行足すだけでよい。実際に切符を買った区間があれば、それが最良の検証データになる。
//   km は各社の公式キロ程、fare は大人のきっぷ運賃(現金)。出典を src に残すこと。

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = { console, module: {}, exports: {} };
vm.createContext(ctx);
for (const f of ["fares.js", "router.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
}
vm.runInContext("globalThis.API = { Network, fareForSegment, toFareKm };", ctx);
const API = ctx.API;

const raw = JSON.parse(fs.readFileSync(path.join(root, "network.json"), "utf8"));
const net = new API.Network(raw);

// ---------------------------------------------------------------------------
// 検証データ。すべて大人・片道・きっぷ運賃(現金)。
// op はその区間を乗り通す事業者。経路はその事業者の路線だけを使って最短で結ぶ。
// ---------------------------------------------------------------------------
const CASES = [
  // --- 小田急【公式のキロ別運賃表と実測で一致を確認】 ---
  // 町田〜本厚木は git履歴に18.4kmと残っていたが、公式キロ程(新宿〜町田30.8 /
  // 新宿〜本厚木45.4)から14.6kmが正しい。推定側ではなく検証データの方が誤っていた。
  { op: "odakyu", from: "町田",     to: "本厚木",   km: 14.6, fare: 270, src: "実測" },
  { op: "odakyu", from: "新宿",     to: "本厚木",   km: 45.4, fare: 520, src: "実測" },
  { op: "odakyu", from: "新宿",     to: "小田原",   km: 82.5, fare: 910, src: "実測" },
  { op: "odakyu", from: "新宿",     to: "海老名",   km: 42.5, fare: 520, src: "実測" },

  // --- 西武【2026年3月14日改定】 ---
  { op: "seibu",  from: "池袋",     to: "所沢",     km: 24.8, fare: 410, src: "実測(IC402円)" },
  { op: "seibu",  from: "池袋",     to: "西武秩父", km: 76.8, fare: 800, src: "実測" },

  // --- 京王【公式のキロ別運賃表・2023年10月改定】 ---
  // 分倍河原21.9kmは府中の営業キロだった(1駅ぶんずれ)。正しくは22.9km。
  // 高尾山口52.6kmも誤りで、公式は44.7km(新宿〜北野36.1 + 高尾線8.6)。
  { op: "keio",   from: "笹塚",     to: "つつじヶ丘", km: 8.9, fare: 190, src: "実測" },
  { op: "keio",   from: "分倍河原", to: "新宿",     km: 22.9, fare: 320, src: "公式キロ程" },
  { op: "keio",   from: "新宿",     to: "高尾山口", km: 44.7, fare: 430, src: "実測" },

  // --- 京成【公式の駅別運賃表 103.pdf(日暮里)・2025年4月1日時点】 ---
  // 営業キロと運賃が併記されているので、距離と運賃の両方を同時に検証できる。
  { op: "keisei", from: "日暮里",   to: "千住大橋", km: 3.8,  fare: 170, src: "京成103.pdf" },
  { op: "keisei", from: "日暮里",   to: "青砥",     km: 9.4,  fare: 200, src: "京成103.pdf" },
  { op: "keisei", from: "日暮里",   to: "京成高砂", km: 10.6, fare: 280, src: "京成103.pdf" },
  { op: "keisei", from: "日暮里",   to: "京成金町", km: 13.1, fare: 280, src: "京成103.pdf" },
  { op: "keisei", from: "日暮里",   to: "押上",     km: 15.1, fare: 340, src: "京成103.pdf" },
  { op: "keisei", from: "日暮里",   to: "京成船橋", km: 23.0, fare: 390, src: "京成103.pdf" },
  { op: "keisei", from: "日暮里",   to: "京成成田", km: 59.1, fare: 800, src: "京成103.pdf" },

  // --- 北総【2022年10月1日改定の公式運賃表】 ---
  { op: "hokuso", from: "京成高砂", to: "東松戸",   km: 7.5,  fare: 380, src: "北総公式" },
  { op: "hokuso", from: "京成高砂", to: "新鎌ヶ谷", km: 12.7, fare: 480, src: "北総公式" },
  { op: "hokuso", from: "京成高砂", to: "印旛日本医大", km: 32.3, fare: 820, src: "北総公式" },

  // --- JR東日本【営業キロは公式・運賃は幹線運賃表(2026年3月14日改定)】 ---
  // 特急や快速の停車駅だけを結んだ「運転系統」の辺が実際の線路より短く出る問題の見張り。
  // 東京〜四ツ谷は中央本線(東京〜塩尻)に途中2駅を飛ばした辺があり、3.4kmと出ていた
  // (公式6.6km)。この行が落ちたら、同じことがどこかで起きている。
  // JRは営業キロの1km未満を切り上げてから運賃表にあてる。6.6km→7km、10.3km→11km。
  { op: "jr", from: "東京",         to: "四ツ谷",   km: 6.6,  fare: 210, src: "公式キロ程" },
  { op: "jr", from: "東京",         to: "新宿",     km: 10.3, fare: 260, src: "公式キロ程" },
  { op: "jr", from: "新宿",         to: "吉祥寺",   km: 12.2, fare: 260, src: "公式キロ程" },
  { op: "jr", from: "葛西臨海公園", to: "市ケ谷",   km: 15.9, fare: 350, src: "公式キロ程" },
  { op: "jr", from: "葛西臨海公園", to: "新宿",     km: 20.9, fare: 440, src: "公式キロ程" },

  // --- 京成松戸線(旧・新京成)【京成103.pdf の松戸線欄】 ---
  // 京成線とは通算されない別体系。初乗り170円・全線280円という形が京成線と全く違う。
  { op: "keisei_matsudo", from: "京成津田沼", to: "北習志野", km: 5.5,  fare: 190, src: "京成103.pdf" },
  { op: "keisei_matsudo", from: "京成津田沼", to: "五香",     km: 19.1, fare: 260, src: "京成103.pdf" },
  { op: "keisei_matsudo", from: "京成津田沼", to: "松戸",     km: 26.5, fare: 280, src: "京成103.pdf" },
];

// ---------------------------------------------------------------------------
// その事業者の路線だけを使って2駅を結ぶ最短経路を求め、営業キロの推定値を返す。
// 運賃計算は実際の乗車経路ではなく最短経路によるため、距離最小で探す。
// ---------------------------------------------------------------------------
function shortestOnOperator(op, fromId, toId) {
  const dist = new Map([[fromId, 0]]);
  const done = new Set();
  while (true) {
    let cur = null, best = Infinity;
    for (const [id, d] of dist) if (!done.has(id) && d < best) { best = d; cur = id; }
    if (cur === null) return null;
    if (cur === toId) return best;
    done.add(cur);
    for (const e of net.adj.get(cur) || []) {
      if (e.walk || net.opOf(e.line) !== op) continue;
      const nd = best + edgeKm(e);
      if (nd < (dist.get(e.to) ?? Infinity)) dist.set(e.to, nd);
    }
  }
}

// 辺の営業キロ。路線別の補正係数を持つようになったらそちらを使う。
function edgeKm(e) {
  return e.km !== undefined ? e.km : API.toFareKm(e.meters);
}

function pick(q) {
  const r = net.search(q, 1);
  if (!r.length) throw new Error("駅が見つからない: " + q);
  return r[0].station;
}

// ---------------------------------------------------------------------------
const pad = (s, n) => {
  // 全角を2桁として数える(表がずれると読めないため)
  const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
  return String(s) + " ".repeat(Math.max(0, n - w));
};
const signed = (v) => (v >= 0 ? "+" : "") + v.toFixed(1);

console.log("運賃の回帰テスト  (大人・片道・きっぷ運賃)");
console.log("実際より高いのは安全側なので許容する。安い行が出たら不合格。\n");
console.log(pad("区間", 26) + pad("公式km", 9) + pad("推定km", 9) + pad("差", 8) +
            pad("実運賃", 8) + pad("算出", 8) + "判定");
console.log("-".repeat(80));

let cheap = 0, exact = 0, expensive = 0, failed = 0;
const cheapRows = [];

for (const c of CASES) {
  let row;
  try {
    const from = pick(c.from), to = pick(c.to);
    const km = shortestOnOperator(c.op, from.id, to.id);
    if (km === null) throw new Error(`${c.op} の路線だけでは結べない`);

    const got = API.fareForSegment(c.op, km, { free: false, kind: "type2", companion: false }).regular;
    const dkm = ((km - c.km) / c.km) * 100;
    const mark = got < c.fare ? "✗ 安い" : got > c.fare ? "△ 高い" : "✓";
    if (got < c.fare) { cheap++; cheapRows.push({ c, km, got }); }
    else if (got > c.fare) expensive++;
    else exact++;

    row = pad(`${c.from}〜${c.to}`, 26) + pad(c.km.toFixed(1), 9) + pad(km.toFixed(2), 9) +
          pad(signed(dkm) + "%", 8) + pad(c.fare + "円", 8) + pad(got + "円", 8) + mark;
  } catch (e) {
    failed++;
    row = pad(`${c.from}〜${c.to}`, 26) + "エラー: " + e.message;
  }
  console.log(row);
}

console.log("-".repeat(80));
console.log(`${CASES.length}件中 一致${exact} / 高い${expensive} / 安い${cheap}` +
            (failed ? ` / 実行できず${failed}` : ""));

if (cheapRows.length) {
  console.log("\n★実際より安く案内している区間(改札で足りなくなる)");
  for (const { c, km, got } of cheapRows) {
    const why = Math.abs(km - c.km) / c.km > 0.02 ? "距離のずれが主因の可能性" : "運賃表の側が主因の可能性";
    console.log(`  ${c.from}〜${c.to}  ${got}円 (実際 ${c.fare}円)  … ${why}`);
  }
}
process.exitCode = cheap || failed ? 1 : 0;
