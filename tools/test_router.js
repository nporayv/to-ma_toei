// 経路探索エンジンの動作確認。 node tools/test_router.js で実行する。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = { console, module: {}, exports: {} };
vm.createContext(ctx);
for (const f of ["fares.js", "router.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
}
// class / const はglobalThisに載らないので、同じコンテキスト内で取り出す
vm.runInContext("globalThis.API = { Network, planRoutes, fareForSegment, toFareKm };", ctx);
const API = ctx.API;

const raw = JSON.parse(fs.readFileSync(path.join(root, "network.json"), "utf8"));
const net = new API.Network(raw);

const nameOf = (id) => net.stations.get(id).name;
const lineOf = (id) => (net.lines.get(id) || {}).name || "徒歩";

function pick(q) {
  const r = net.search(q, 1);
  if (!r.length) throw new Error("駅が見つからない: " + q);
  return r[0].station;
}

function show(title, fromQ, toQ, opts = { kind: "type2", companion: false }) {
  const from = pick(fromQ), to = pick(toQ);
  console.log("\n" + "=".repeat(72));
  console.log(`${title}:  ${from.name} → ${to.name}`);
  console.log("=".repeat(72));
  const t0 = Date.now();
  const res = API.planRoutes(net, from.id, to.id, opts);
  console.log(`  (探索 ${Date.now() - t0}ms)`);
  if (!res.options.length) { console.log("  経路なし"); return res; }

  res.options.forEach((o, i) => {
    const tag = i === 0 ? "【最安】" : "【比較】";
    console.log(`\n${tag} 運賃 ${o.totalActual}円 (通常 ${o.totalRegular}円) / 約${o.time}分 / 乗換${o.transfers}回`);
    if (o.usesFree) {
      console.log(`      都営線に入る駅: ${nameOf(o.freeEntry)}  →  出る駅: ${nameOf(o.freeExit)}`);
    } else {
      console.log("      ※ 都営線を利用しない経路");
    }
    for (const g of o.fareGroups) {
      const head = g.walk ? "徒歩" : `${net.operators[g.op].name}`;
      const money = g.walk ? "" : (g.free ? "  → 0円(無料乗車券)" : `  → ${g.actual}円 (通常${g.regular}円)`);
      console.log(`   ${head}: ${(g.meters / 1000).toFixed(1)}km${money}`);
      for (const l of g.legs) {
        const a = net.labelOf(l.path[0], l.line), b = net.labelOf(l.path.slice(-1)[0], l.line);
        console.log(`      ${lineOf(l.line)}  ${a} → ${b} (${l.path.length - 1}駅)`);
      }
    }
  });
  return res;
}

console.log("駅数:", net.stations.size, "/ 路線数:", net.lines.size, "/ 都営無料駅数:", net.freeStations.size);

show("ユーザー例1", "青砥", "日本橋");
show("ユーザー例2", "青砥", "中野坂上");
show("JR only 起点", "吉祥寺", "浅草");
show("都営が使えない例", "自由が丘", "二子玉川");
show("郊外どうし", "町田", "北千住");
show("第1種+介護者", "青砥", "中野坂上", { kind: "type1", companion: true });
