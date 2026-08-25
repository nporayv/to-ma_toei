// 表示まわりの、ごく小さな仕掛け。
//
// 経路探索・運賃計算の本体とは一切関係がないため、この1ファイルに閉じてある。
// index.html からこのファイルの読み込みを外せば、それだけで元の動きに戻る。
// router.js と app.js には手を入れていない。
//
// 起こしかた:
//   出発駅と到着駅の両方に「青砥」を入れて検索する。
//   画面には「同じ駅です」と出るだけで、見た目は普通の入力ミスと変わらない。
//   そのあと駅名を入力すると、候補の末尾に見慣れない駅が1つ混ざる。
//   それを選んで検索すると、ユーカリが丘までの経路が出る。一度使うと元に戻る。
//
// 邪魔をしないための約束ごと:
//   候補は必ず「末尾」に足す。app.js の resolve() は net.search(値, 1) と
//   上限1で呼ぶため、末尾に足すぶんには通常の駅名解決を一切妨げない。
//   仕掛けが起きている間も、目的の駅はいつもどおり検索できる。
(function () {
  "use strict";

  var TRIGGER = 2300109;   // 青砥
  var DEST    = 2300133;   // ユーカリが丘
  var ID      = "kisaragi";
  var KEY     = "mshiki";

  var STATION = { id: ID, name: "きさらぎ駅", lat: 0, lon: 0, aliases: [], lines: [] };

  // localStorage は使えないことがある(プライベートウィンドウなど)。
  // 使えなければ仕掛けが起きないだけで、本体の動作には影響しない。
  function armed() {
    try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }
  function arm(on) {
    try { on ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch (e) {}
  }

  // --- 候補の末尾に1つ足す -------------------------------------------------
  var origSearch = Network.prototype.search;
  Network.prototype.search = function (query, limit) {
    if (limit === undefined) limit = 12;
    var hits = origSearch.call(this, query, limit);
    // 上限1のときは駅名を確定させる呼び出しなので、絶対に足さない
    if (limit > 1 && hits.length && armed()) {
      hits.push({ score: 9, station: STATION, matched: STATION.name });
    }
    return hits;
  };

  // --- その駅を選んで検索されたら、ユーカリが丘として経路を出す -------------
  var origPlan = planRoutes;
  planRoutes = function (net, from, to, opts) {
    if (from === ID || to === ID) {
      arm(false);                       // 一度きり
      if (from === ID) from = DEST;
      if (to === ID) to = DEST;
    }
    return origPlan(net, from, to, opts);
  };

  // --- 青砥 → 青砥 で仕掛けを起こす ----------------------------------------
  var form = document.getElementById("searchForm");
  if (!form) return;

  function stationIdOf(value) {
    // 差し込み前の検索を使う(自分で足した候補を拾わないため)。
    // net は app.js の let 宣言なので window のプロパティにはならない。
    // 素の識別子で参照する必要がある。
    if (!value) return null;
    try {
      if (!net) return null;
      var hits = origSearch.call(net, value, 1);
      return hits.length ? hits[0].station.id : null;
    } catch (e) { return null; }
  }

  form.addEventListener("submit", function () {
    var a = stationIdOf(document.getElementById("fromInput").value);
    var b = document.getElementById("toInput");
    if (a === TRIGGER && stationIdOf(b.value) === TRIGGER) arm(true);
  });
})();
