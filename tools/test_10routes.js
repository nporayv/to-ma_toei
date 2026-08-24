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

// 提供された10区間。expected は実際の運賃が判明したら埋める(円)。
const CASES = [
  ["流山おおたかの森", "武蔵小杉"],
  ["北参道", "川崎大師"],
  ["青砥", "三鷹"],
  ["渋谷", "みなとみらい"],
  ["松戸", "ユーカリヶ丘"],
  ["新宿", "生田"],
  ["横浜", "舞浜"],
  ["強羅", "京成立石"],
  ["京成八幡", "蒲田"],
  ["渋谷", "四ツ木"]
];

let ng = 0;
CASES.forEach(([fromQ, toQ], i) => {
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
});

console.log("\n" + "=".repeat(72));
console.log(ng ? `★ ${ng}件で経路を出せませんでした` : "10区間すべてで経路を出しました(運賃の正しさは別問題)");
