// テスト単一行程版 - メモリ効率を改善
// 使い方: node test_single_route.js <区間番号|区間名>
// 例: node test_single_route.js 1
// 例: node test_single_route.js "流山おおたかの森→武蔵小杉"

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
  {
    from: "松戸", to: "ユーカリヶ丘",
    expected: {
      regular: 710, free: 710,
      per: [["jr", 200], ["keisei", 510]],
      note: "JR常磐線 松戸→金町 / 京成金町線・本線 金町→(高砂)→八千代台→ユーカリが丘",
      source: "Navitime 2026-08-25"
    }
  },
  {
    from: "新宿", to: "生田",
    expected: {
      regular: 300, free: 300,
      per: [["odakyu", 300]],
      note: "小田急小田原線急行・各停 新宿→成城学園前→生田",
      source: "Navitime 2026-08-25"
    }
  },
  {
    from: "横浜", to: "舞浜",
    expected: {
      regular: 790, free: 570,
      per: [["tokyu", 310], ["toei", 220], ["jr", 260]],
      note: "東急東横線 横浜→武蔵小杉 / 東急目黒線 武蔵小杉→(直通)目黒 / 都営三田線 目黒→日比谷 / JR武蔵野線 東京→舞浜",
      source: "Navitime 2026-08-25"
    }
  },
  {
    from: "強羅", to: "京成立石",
    expected: {
      regular: 2240, free: 1890,
      per: [["other", 770], ["odakyu", 910], ["jr", 210], ["toei", 180], ["keisei", 170]],
      note: "箱根登山線 強羅→小田原 / 小田急 小田原→新宿 / JR中央線 新宿→御茶ノ水 / JR中央総武線 御茶ノ水→浅草橋 / 都営浅草線 浅草橋→(直通)押上 / 京成押上線 押上→京成立石",
      source: "Navitime 2026-08-25"
    }
  },
  {
    from: "京成八幡", to: "蒲田",
    expected: {
      regular: 680, free: 350,
      per: [["toei", 330], ["jr", 350]],
      note: "都営新宿線 本八幡→馬喰横山 / JR総武線快速・横須賀線 馬喰町→(直通)東京→品川 / JR京浜東北・根岸線 品川→蒲田",
      source: "Navitime 2026-08-25"
    }
  },
  {
    from: "渋谷", to: "四ツ木",
    expected: {
      regular: 500, free: 170,
      per: [["metro", 170], ["toei", 330], ["keisei", 170]],
      note: "東京メトロ銀座線 渋谷→日本橋 / 都営浅草線 日本橋→(直通)押上 / 京成押上線 押上→四ツ木",
      source: "Navitime 2026-08-25"
    }
  }
];

const arg = process.argv[2];
let targetCase;

if (!arg) {
  console.log("使い方: node test_single_route.js <区間番号(1-10) | 区間名>");
  console.log("\n利用可能な区間:");
  CASES.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.from} → ${c.to}`);
  });
  process.exit(1);
}

if (/^\d+$/.test(arg)) {
  const idx = parseInt(arg) - 1;
  if (idx < 0 || idx >= CASES.length) {
    console.error(`エラー: 区間番号は1-${CASES.length}の範囲で指定してください`);
    process.exit(1);
  }
  targetCase = CASES[idx];
} else {
  // 駅名で検索
  targetCase = CASES.find(c => arg.includes(c.from) && arg.includes(c.to));
  if (!targetCase) {
    console.error(`エラー: 区間 "${arg}" が見つかりません`);
    process.exit(1);
  }
}

const { from: fromQ, to: toQ, expected } = targetCase;
const a = net.search(fromQ, 1), b = net.search(toQ, 1);

console.log("=".repeat(72));
if (!a.length || !b.length) {
  console.log(`${fromQ} → ${toQ}  ★駅が見つからない: ${!a.length ? fromQ : toQ}`);
  process.exit(1);
}

const from = a[0].station, to = b[0].station;
console.log(`${fromQ} → ${toQ}  (${from.name} → ${to.name})`);

const t0 = Date.now();
const res = API.planRoutes(net, from.id, to.id, { kind: "type2", companion: false });
console.log(`探索 ${Date.now() - t0}ms / 候補 ${res.options.length}`);

if (!res.options.length) {
  console.log("★経路なし");
  process.exit(1);
}

res.options.forEach((o, j) => {
  const head = j === 0 ? "【最安】" : "【比較】";
  const free = o.usesFree ? `都営 ${nameOf(o.freeEntry)} → ${nameOf(o.freeExit)}` : "都営線を使わない";
  console.log(`${head} ${o.totalActual}円 (通常${o.totalRegular}円) / 約${o.time}分 / 乗換${o.transfers}回 / ${free}`);
  for (const g of o.fareGroups) {
    const label = g.walk ? "徒歩" : net.operators[g.op].name;
    const money = g.walk ? "" : (g.free ? " → 0円" : ` → ${g.actual}円(通常${g.regular}円)`);
    console.log(`  ${label}: ${(g.meters / 1000).toFixed(1)}km${money}`);
    for (const l of g.legs) {
      const s = net.labelOf(l.path[0], l.line), e = net.labelOf(l.path.slice(-1)[0], l.line);
      console.log(`    ${lineOf(l.line)} ${s} → ${e} (${l.path.length - 1}駅)`);
    }
  }
});

if (!expected) {
  console.log("\n期待値なし");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 実データとの突き合わせ
//
// ★比較の作法★ ここを間違えると、正しい動作を「危険」と誤検知する。
//   実データ(乗換案内)は (1)障害者割引を知らない通常運賃で、しかも
//   (2)本サービスとは別の経路のことがある。それを本サービスの実費(割引後)と
//   そのまま引き算すると、割引が効いているぶんだけ「安すぎる」と出てしまう。
//   実際にこの誤りで10区間中7区間が誤警告し、正しい実装を疑わせていた
//   (2026-08-31に修正)。
//
//   そこで合否は次の一点だけで判定する:
//     同じ事業者を通っているとき、本サービスの「通常運賃」が実測より安いか。
//   通常運賃は割引の有無に左右されないため、運賃表の誤りだけを拾える。
//   合計額の比較は、経路が違えば意味を持たないので合否に使わない。
// ---------------------------------------------------------------------------
const half = (yen) => Math.ceil(yen / 2 / 10) * 10;
const ALWAYS_HALF = new Set(["keisei", "keisei_matsudo", "hokuso"]);

const best = res.options[0];
const mine = new Map();
for (const g of best.fareGroups) {
  if (g.walk) continue;
  mine.set(g.op, (mine.get(g.op) || 0) + g.regular);
}

console.log(`\n―― 実データとの突き合わせ (${expected.source})`);
console.log(`実データの経路: ${expected.note}`);

const cheaper = [];   // 運賃表が実際より安い = 危険
const offRoute = [];  // 実データ側にしかない事業者 = 別経路なので比較できない
for (const [op, yen] of expected.per) {
  const got = mine.get(op);
  const name = (net.operators[op] || {}).name || op;
  if (got == null) { offRoute.push(name); continue; }
  const diff = got - yen;
  const mark = diff === 0 ? "一致"
    : diff > 0 ? `+${diff}円 (高い=安全側)`
    : `${diff}円 ★安い`;
  console.log(`  ${name}: 実測 ${yen}円 / 本サービス ${got}円  ${mark}`);
  if (diff < 0) cheaper.push(`${name} ${got}円 < 実測${yen}円`);
}
if (offRoute.length) {
  console.log(`  実データが通る ${offRoute.join("・")} を、本サービスは通らない(別経路を選んでいる)`);
}

// 実データ側にも同じ割引ルールを当てた参考値。目安として出すだけで合否には使わない。
let refActual = 0;
for (const [op, yen] of expected.per) {
  if ((net.operators[op] || {}).free) continue;
  refActual += ALWAYS_HALF.has(op) ? half(yen) : yen;
}
console.log(`  参考: 実データの経路に割引を当てると ${refActual}円 / 本サービスの案内は ${best.totalActual}円`);

// ---------------------------------------------------------------------------
// ★このスクリプトは合否を出さない★
//
//   社ごとの金額を比べても合否は決められない。同じ事業者でも、本サービスと
//   実データでは乗っている区間が違うことがあるからで、そのときの差は
//   運賃表の誤りではなく経路の違いを見ているにすぎない。
//   直通運転では社ごとの内訳の切り方も一致しない
//   (渋谷〜みなとみらい: 実データは東急310+MM200、本サービスは東急320+MM190。
//    合計はどちらも510円で正しい)。
//
//   運賃表が正しいかどうかの判定は tools/test_fares.js が担う。
//   あちらは「事業者・営業キロ・実運賃」を1点ずつ突き合わせるので、
//   経路の違いに影響されない。差が気になったら、その区間の実運賃を調べて
//   test_fares.js の CASES に1行足すこと。それが唯一の正しい直し方。
// ---------------------------------------------------------------------------
console.log("");
if (cheaper.length) {
  console.log("要確認: 実データより安い社があります ── " + cheaper.join(" / "));
  console.log("  経路が違うだけかもしれません。実運賃を調べて tools/test_fares.js に足して判定してください。");
} else if (offRoute.length) {
  console.log("参考: 同じ事業者の運賃はすべて実測以上でした(別経路を選んでいるため合計は比較不可)。");
} else {
  console.log("参考: 同じ経路・同じ事業者で、運賃はすべて実測以上でした。");
}
console.log("運賃表そのものの合否は  node tools/test_fares.js  で判定します。");
