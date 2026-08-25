// 運賃計算と障害者割引のルール
//
// ★重要★ ここに定義する運賃表は「概算」です。
// 実際の運賃は各社の営業キロに基づく距離制で決まりますが、本サービスは
// 駅の緯度経度から求めた直線距離に補正係数をかけて営業キロを推定しています。
// 数十円程度のずれが出ることがあります。正確な運賃は各社の公式案内をご確認ください。

// 直線距離 → 営業キロ の補正係数。
// 隣り合う駅どうしの直線距離を足し合わせると線路長にかなり近くなるため、係数は小さい。
// 都営3線・京成押上線・山手線の公式キロ程と突き合わせて 1.04 とした
// (tools/test_router.js の校正結果: 平均比 1.036)。
const ROUTE_FACTOR = 1.04;

// 事業者ごとの運賃表(きっぷ運賃・10円単位)
// [上限km, 運賃] の並び。上から順に最初に該当したものを採用する。
//
// ★保守の注意★
//   運賃改定は思ったより頻繁にある(JR東日本 2026年3月13日に電車特定区間廃止、
//   西武 2026年3月14日改定)。改定を取りこぼすと、実際より安く案内してしまう。
//   下の一覧の「確認日」が古くなっていたら、各社の運賃表で見直すこと。
//
//   確認状況(2026-08-23時点):
//     JR東日本  … 公式運賃表で確認済み(2026年3月改定・幹線運賃)
//     小田急    … 実際の運賃3区間で校正済み
//     西武      … 2026年3月14日改定を反映
//     東京メトロ・都営 … 路線が短く上限まで表があるため実用上問題なし
//     その他各社 … 短距離帯のみ確からしい。長距離帯は推定値
//
//   なお距離そのものにも誤差がある。駅間の直線距離を足す方式のため、
//   急行線のように駅間が長い区間では線路の曲がりを拾えず短めに出る。
const FARE_TABLES = {
  // JR東日本 幹線(きっぷ運賃)。
  // 東京近郊の「電車特定区間」と「山手線内」の運賃区分は2026年3月13日に廃止され、
  // 都区内も幹線の運賃になった。以前の電車特定区間の表を使うと10〜50円安く出る。
  // https://jr-group.jp/higashinihon-fare/
  jr: [[3, 160], [6, 200], [10, 210], [15, 260], [20, 350], [25, 440],
       [30, 530], [35, 620], [40, 720], [45, 810], [50, 910], [60, 1040],
       [70, 1230], [80, 1410], [90, 1600], [100, 1790], [Infinity, 2090]],
  // 東京メトロ・都営地下鉄は路線が短く(最長40km程度)、上限額まで表があれば足りる
  metro: [[6, 180], [11, 210], [19, 260], [27, 300], [Infinity, 340]],
  toei: [[4, 180], [9, 220], [15, 280], [21, 330], [27, 380], [Infinity, 430]],

  // 小田急【実際の運賃で校正済み】
  //   町田〜本厚木 18.4km=270円 / 新宿〜本厚木 45.4km=520円 / 新宿〜小田原 82.5km=910円
  odakyu: [[3, 140], [6, 170], [10, 200], [15, 240], [20, 270], [26, 330], [32, 390],
           [38, 450], [46, 520], [55, 620], [65, 720], [75, 820], [Infinity, 910]],

  // 西武【2026年3月14日の運賃改定を反映】
  //   池袋〜所沢 24.8km=402円(IC) / 池袋〜西武秩父 76.8km=800円 / 初乗り169円(IC)
  seibu: [[3, 170], [6, 200], [10, 240], [14, 290], [18, 340], [25, 410], [32, 480],
          [40, 550], [50, 640], [65, 730], [Infinity, 800]],

  // ここから下は短距離帯のみ確からしく、長距離帯は推定。
  // 都心の移動では届かない距離なので実害は小さいが、遠方を調べると誤差が大きい。
  // 正確を期すなら各社の運賃表で確認して差し替えること。
  keisei: [[3, 150], [6, 200], [10, 270], [14, 320], [19, 370], [24, 440], [30, 500],
           [38, 580], [46, 680], [56, 830], [Infinity, 1050]],
  keikyu: [[3, 150], [6, 200], [10, 230], [15, 300], [20, 330], [25, 400], [32, 480],
           [40, 570], [50, 690], [Infinity, 950]],
  tokyu: [[3, 140], [6, 170], [10, 200], [14, 230], [18, 260], [22, 290], [27, 320],
          [Infinity, 340]],
  // 京王【公式のキロ別運賃表で確認済み・2023年10月改定】
  //   https://www.keio.co.jp/train/ticket/fare_chart/fare_chart_km.html
  keio: [[4, 140], [6, 160], [9, 190], [12, 210], [15, 230], [19, 280], [24, 320],
         [30, 360], [37, 390], [44, 410], [Infinity, 430]],
  tobu: [[4, 150], [7, 190], [10, 210], [13, 250], [17, 290], [21, 330], [26, 400],
         [32, 470], [40, 560], [50, 680], [65, 830], [80, 1000], [100, 1200],
         [Infinity, 1600]],
  sotetsu: [[3, 150], [6, 180], [10, 200], [14, 240], [18, 280], [24, 320], [Infinity, 360]],
  tx: [[3, 170], [6, 220], [10, 290], [15, 340], [20, 400], [Infinity, 470]],
  rinkai: [[4, 220], [7, 330], [10, 410], [Infinity, 510]],
  yurikamome: [[3, 200], [6, 270], [10, 340], [Infinity, 400]],
  monorail: [[5, 200], [10, 350], [Infinity, 500]],
  hokuso: [[3, 210], [6, 330], [10, 430], [15, 550], [Infinity, 660]],
  shinkeisei: [[3, 150], [6, 200], [10, 260], [Infinity, 310]],
  toyo: [[3, 210], [6, 330], [10, 440], [Infinity, 560]],
  saitama: [[3, 210], [6, 290], [10, 390], [Infinity, 480]],
  yokohama: [[3, 210], [7, 240], [11, 290], [15, 330], [Infinity, 390]],
  tamamono: [[3, 210], [6, 280], [10, 360], [Infinity, 430]],
  mm: [[3, 190], [6, 220], [Infinity, 240]],
  // 無料乗車券の対象。「本来いくらかかるか」を示すために表は持っておく。
  toden: [[Infinity, 170]],
  toneri: [[3, 170], [6, 220], [10, 270], [Infinity, 330]],
  other: [[3, 180], [6, 240], [10, 300], [Infinity, 400]]
};

// ---------------------------------------------------------------------------
// 障害者割引の適用条件
//
// ★ここは事業者ごとに大きく違う。そして都内の移動はほぼ100km未満なので、
//   「単独乗車では割引が効かない会社が多い」という事実が実費に直結する。
//   ここを甘く見積もると実際より安い運賃を案内してしまい、
//   利用者が改札で足りない思いをする。必ず一次情報で裏を取ること。
//
//   solo の意味:
//     "always"    … 単独乗車でも距離条件なしで5割引
//     "over50km"  … 単独乗車は自社線内50km超のみ5割引
//     "over100km" … 単独乗車は片道100km(101km)超のみ5割引 = 都内では実質割引なし
//
//   なお第1種は介護者と同時に乗車する場合、どの社も距離条件なしで
//   本人・介護者とも5割引になる(下の fareForSegment で処理)。
//   第2種の介護者は割引対象外(東京メトロは「適用されません」と明記)。
// ---------------------------------------------------------------------------
const DISCOUNT_RULES = {
  // 京成グループは距離条件なしで5割引。都内での実費に直結する重要な例外。
  // 京成: 自社線内で完結するなら第1種・第2種とも距離条件なし。
  //   他社線への連絡乗車券にする場合のみ通算100km超が条件になるが、
  //   無料乗車券の利用者は都営線を別に乗るので線内完結として扱ってよい。
  //   https://www.keisei.co.jp/keisei/tetudou/accessj/goriyo.php
  keisei: "always",
  // 北総: 「ご本人様単独で乗車する場合、ご本人様に割引乗車券を発売します」。
  //   第1種・第2種の区別も距離条件もない。
  //   https://www.hokuso-railway.co.jp/railway/information.html
  hokuso: "always",

  // 西武だけ基準が50km。都内〜近郊では届かないが、秩父方面なら効く。
  // https://www.seiburailway.jp/railway/ticket/ticket/discount/
  seibu: "over50km",

  // 以下はいずれも単独乗車だと片道100km(101km)超が条件。都内では割引が効かない。
  jr: "over100km",        // https://www.jreast.co.jp/kippu/yakkan/pdf/disability_discount.pdf
  metro: "over100km",     // https://www.tokyometro.jp/ticket/guide/disability/index.html
  tobu: "over100km",      // https://www.tobu.co.jp/railway/ticket/disability/
  odakyu: "over100km",    // https://www.odakyu.jp/ticket/discount/
  keikyu: "over100km",    // https://www.keikyu.co.jp/ride/ticket/unchin_waribiki.html
  keio: "over100km",      // https://www.keio.co.jp/train/ticket/discount/
  // 東急は単独乗車の割引そのものが無い(介護者同伴のみ)。
  // 東急線は最長でも100km未満なので over100km と同じ結果になる。
  tokyu: "over100km"      // https://www.tokyu.co.jp/railway/ticket/disability/
};

// 未確認の事業者は over100km(=都内では割引なし)を既定とする。
// 実際より高く見積もる方向なので、案内としては安全側に倒れる。
const DEFAULT_RULE = "over100km";

function discountRuleFor(op) {
  return DISCOUNT_RULES[op] || DEFAULT_RULE;
}

// 割引後運賃: 半額・10円未満切り上げ(磁気式きっぷの一般的な扱い)
function halfFare(fare) {
  return Math.ceil(fare / 2 / 10) * 10;
}

/**
 * 1事業者ぶんの運賃を求める。
 * @param {string} op    事業者ID
 * @param {number} km    その事業者に乗った営業キロ(推定)
 * @param {object} opts  { free:bool, kind:"type1"|"type2", companion:bool }
 * @returns {{regular:number, actual:number, note:string}}
 */
function fareForSegment(op, km, opts) {
  const table = FARE_TABLES[op] || FARE_TABLES.other;
  let regular = table[table.length - 1][1];
  for (const [limit, yen] of table) {
    if (km <= limit) { regular = yen; break; }
  }

  // 都営交通無料乗車券の対象事業者は無料
  if (opts.free) {
    return { regular, actual: 0, note: "無料乗車券で無料" };
  }

  // 第1種で介護者と同時に乗車する場合は、どの社も距離条件なしで5割引。
  // (介護者ぶんの運賃は別途かかる)
  if (opts.kind === "type1" && opts.companion) {
    return { regular, actual: halfFare(regular), note: "第1種・介護者同伴のため半額" };
  }

  const rule = discountRuleFor(op);
  if (rule === "always") {
    return { regular, actual: halfFare(regular), note: "手帳提示で半額(自社線内)" };
  }
  const limit = rule === "over50km" ? 50 : 100;
  if (km > limit) {
    return { regular, actual: halfFare(regular), note: limit + "km超のため半額" };
  }
  // ここが都内の移動ではほとんどの会社に当てはまる
  return { regular, actual: regular, note: "単独乗車・" + limit + "km以内のため割引なし" };
}

// 直線距離(m)の合計から営業キロ(推定)へ
function toFareKm(meters) {
  return (meters * ROUTE_FACTOR) / 1000;
}
