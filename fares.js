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
const FARE_TABLES = {
  // JR東日本 電車特定区間
  jr: [[3, 150], [6, 180], [10, 210], [15, 250], [20, 320], [25, 400],
       [30, 480], [35, 590], [40, 680], [45, 770], [50, 860], [60, 990], [Infinity, 1170]],
  metro: [[6, 180], [11, 210], [19, 260], [27, 300], [Infinity, 340]],
  toei: [[4, 180], [9, 220], [15, 280], [21, 330], [27, 380], [Infinity, 430]],
  keisei: [[3, 150], [6, 200], [10, 270], [14, 320], [19, 370], [24, 440], [30, 500], [Infinity, 560]],
  keikyu: [[3, 150], [6, 200], [10, 230], [15, 300], [20, 350], [25, 400], [Infinity, 460]],
  tokyu: [[3, 140], [6, 170], [10, 200], [14, 230], [18, 260], [22, 290], [Infinity, 320]],
  keio: [[4, 140], [8, 170], [12, 200], [16, 230], [20, 270], [25, 300], [Infinity, 330]],
  odakyu: [[3, 140], [6, 170], [10, 200], [14, 230], [18, 270], [23, 300], [Infinity, 330]],
  tobu: [[4, 150], [7, 190], [10, 210], [13, 250], [17, 290], [21, 330], [Infinity, 370]],
  seibu: [[4, 150], [7, 180], [10, 200], [13, 240], [17, 270], [21, 300], [Infinity, 330]],
  sotetsu: [[3, 150], [6, 180], [10, 200], [14, 240], [Infinity, 270]],
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
