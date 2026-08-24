// 提供された10区間のサンプル経路をまとめて流す。 node tools/test_10routes.js
//
// docs/data-requests.md で挙げている運賃データの不足が、どの区間でどう出るかを
// 目で確かめるためのもの。実際の運賃が分かったら EXPECTED に書き足していく。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = { console, module: {}, exports: {} };
vm.createContext(ctx);
for (const f of ["fares.js", "router.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
}
vm.runInContext("globalThis.API = { Network, planRoutes };", ctx);
const API = ctx.API;
const net = new API.Network(JSON.parse(fs.readFileSync(path.join(root, "network.json"), "utf8")));

const nameOf = (id) => net.stations.get(id).name;
const lineOf = (id) => (net.lines.get(id) || {}).name || "徒歩";

// 提供された10区間。
// expected は乗換案内の実データ(社ごとの内訳)。分かったものから埋めていく。
//   regular … 無料乗車券を使わない場合の合計(きっぷ運賃)
//   free    … 都営ぶんを0円にした場合の合計(このサービスが案内すべき額)
//   per     … 社ごとのきっぷ運賃。[事業者ID, 円]
const CASES = [
  {
    from: "流山おおたかの森", to: "武蔵小杉",
    expected: {
      regular: 1200, free: 920,
      per: [["tx", 690], ["toei", 280], ["tokyu", 230]],
      note: "TX 流山おおたかの森→新御徒町 / 都営 新御徒町→(春日)→目黒 / 東急目黒線 目黒→武蔵小杉",
      source: "乗換案内の検索結果(2026-08)"
    }
  },
  {
    from: "北参道", to: "川崎大師",
    expected: {
      regular: 670, free: 490,
      per: [["toei", 180], ["jr", 210], ["keikyu", 280]],
      note: "都営副都心線 北参道→渋谷 / JR山手線 渋谷→品川 / 京浜急行 品川→京急川崎→川崎大師",
      source: "Navitime 2026-08"
    }
  },
  {
    from: "青砥", to: "三鷹",
    expected: {
      regular: 740, free: 460,
      per: [["keisei", 200], ["toei", 280], ["jr", 260]],
      note: "京成押上線 青砥→押上 / 都営浅草線 押上→東日本橋 / 都営新宿線 馬喰横山→新宿 / JR中央線快速 新宿→三鷹",
      source: "Navitime 2026-08"
    }
  },
  {
    from: "渋谷", to: "みなとみらい",
    expected: {
      regular: 510, free: 510,
      per: [["tokyu", 310], ["mm", 200]],
      note: "東急東横線急行 渋谷→横浜 / みなとみらい線急行 横浜→みなとみらい (乗換0回・直通)",
      source: "Navitime 2026-08-25"
    }
  },
  { from: "松戸", to: "ユーカリヶ丘", note: "need Navitime" },
  { from: "新宿", to: "生田", note: "need Navitime" },
  { from: "横浜", to: "舞浜", note: "need Navitime" },
  { from: "強羅", to: "京成立石", note: "need Navitime" },
  { from: "京成八幡", to: "蒲田", note: "need Navitime" },
  { from: "渋谷", to: "四ツ木", note: "need Navitime" }
];

let ng = 0;
CASES.forEach((c, i) => {
  const { from: fromQ, to: toQ, expected } = c;
  const a = net.search(fromQ, 1), b = net.search(toQ, 1);
  console.log("\n" + "=".repeat(72));
  if (!a.length || !b.length) {
    console.log(`${i + 1}. ${fromQ} → ${toQ}  ★駅が見つからない: ${!a.length ? fromQ : toQ}`);
    ng++;
    return;
  }
  const from = a[0].station, to = b[0].station;
  console.log(`${i + 1}. ${fromQ} → ${toQ}  (${from.name} → ${to.name})`);
  const t0 = Date.now();
  const res = API.planRoutes(net, from.id, to.id, { kind: "type2", companion: false });
  console.log(`   探索 ${Date.now() - t0}ms / 候補 ${res.options.length}`);
  if (!res.options.length) { console.log("   ★経路なし"); ng++; return; }

  res.options.forEach((o, j) => {
    const head = j === 0 ? "【最安】" : "【比較】";
    const free = o.usesFree ? `都営 ${nameOf(o.freeEntry)} → ${nameOf(o.freeExit)}` : "都営線を使わない";
    console.log(`  ${head} ${o.totalActual}円 (通常${o.totalRegular}円) / 約${o.time}分 / 乗換${o.transfers}回 / ${free}`);
    for (const g of o.fareGroups) {
      const label = g.walk ? "徒歩" : net.operators[g.op].name;
      const money = g.walk ? "" : (g.free ? " → 0円" : ` → ${g.actual}円(通常${g.regular}円)`);
      console.log(`     ${label}: ${(g.meters / 1000).toFixed(1)}km${money}`);
      for (const l of g.legs) {
        const s = net.labelOf(l.path[0], l.line), e = net.labelOf(l.path.slice(-1)[0], l.line);
        console.log(`        ${lineOf(l.line)} ${s} → ${e} (${l.path.length - 1}駅)`);
      }
    }
  });

  if (!expected) return;
  // 実データとの突き合わせ。経路が違えば運賃も違うので、社ごとの額で見比べる。
  const best = res.options[0];
  const mine = new Map();
  for (const g of best.fareGroups) {
    if (g.walk) continue;
    mine.set(g.op, (mine.get(g.op) || 0) + g.regular);
  }
  console.log(`\n  ―― 実データとの差 (${expected.source})`);
  console.log(`     ${expected.note}`);
  for (const [op, yen] of expected.per) {
    const got = mine.get(op);
    const name = (net.operators[op] || {}).name || op;
    if (got == null) { console.log(`     ${name}: 実 ${yen}円 / この経路では通っていない`); continue; }
    const diff = got - yen;
    console.log(`     ${name}: 実 ${yen}円 / 見積 ${got}円 ${diff === 0 ? "(一致)" : `(${diff > 0 ? "+" : ""}${diff}円)`}`);
  }
  console.log(`     合計(通常): 実 ${expected.regular}円 / 見積 ${best.totalRegular}円`);
  console.log(`     合計(無料券): 実 ${expected.free}円 / 見積 ${best.totalActual}円`);
  if (best.totalActual < expected.free) {
    console.log(`     ★ ${expected.free - best.totalActual}円 安く見積もっている(利用者が改札で足りなくなる向き)`);
  }
});

console.log("\n" + "=".repeat(72));
console.log(ng ? `★ ${ng}件で経路を出せませんでした` : "10区間すべてで経路を出しました(運賃の正しさは別問題)");
