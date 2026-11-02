/*
 * 澈點科學財務系統：官網訂單同步（書籤小工具載入的腳本）
 *
 * 在使用者已登入的 Leviax 官網後台執行：用隱藏的 iframe 依序打開「訂單管理」三個分頁
 * （待處理／已完成／已取消）讀出每張訂單，再讀「課程管理」「書籍管理」「定價與優惠 › 優惠碼」
 * 的商品清單，一起送到記帳系統的 /api/web-orders/sync。
 * 只讀官網、不改官網；不讀也不送電話、地址、匯款末五碼。
 * 書籤會先設定 window.__LX_SYNC = { key, api, back }。
 */
(function () {
  "use strict";
  var cfg = window.__LX_SYNC || {};
  var TABS = ["pending", "completed", "cancelled"];
  var HEAD_RE = /^(LX-\d{8}-\d{3})\s*·\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(上午|下午)?(\d{1,2}):(\d{2}):(\d{2})\s*·\s*NT\$([\d,]+)(?:\s*\(-NT\$([\d,]+)\))?/;

  // ── 畫面上的進度提示 ──
  var box = document.createElement("div");
  box.style.cssText =
    "position:fixed;z-index:2147483647;top:16px;right:16px;max-width:360px;padding:14px 16px;border-radius:12px;" +
    "background:#173b69;color:#fff;font:14px/1.6 system-ui,'Noto Sans TC',sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)";
  document.body.appendChild(box);
  function say(msg, isError) {
    box.style.background = isError ? "#b91c1c" : "#173b69";
    box.innerHTML = "<b>澈點科學財務系統｜官網對帳</b><br>" + msg;
  }

  if (!cfg.key || !cfg.api) return say("書籤設定不完整，請回記帳系統「官網對帳」重新拖曳書籤。", true);
  if (location.hostname !== "leviax-lab.vercel.app") return say("請在 Leviax 官網（leviax-lab.vercel.app）的後台頁面點這個書籤。", true);

  function parseDoc(doc, tab) {
    var main = doc.querySelector("main");
    if (!main) throw new Error("讀不到訂單頁，請確認已登入官網後台");
    var heads = Array.prototype.filter.call(main.querySelectorAll("*"), function (e) {
      return e.children.length === 0 && /^LX-\d{8}-\d{3}/.test(e.textContent.trim());
    });
    return heads.map(function (h) {
      var card = h.closest("div.rounded-xl");
      if (!card) throw new Error("訂單卡片結構變了（官網可能改版）");
      var lines = card.innerText.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      var hi = lines.findIndex(function (l) { return /^LX-\d{8}-\d{3}/.test(l); });
      var m = lines[hi].match(HEAD_RE);
      if (!m) throw new Error("讀不懂這行訂單資訊：" + lines[hi]);
      var hh = +m[6];
      if (m[5] === "下午" && hh < 12) hh += 12;
      if (m[5] === "上午" && hh === 12) hh = 0;
      var at = m[2] + "-" + m[3].padStart(2, "0") + "-" + m[4].padStart(2, "0") + "T" + String(hh).padStart(2, "0") + ":" + m[7] + ":" + m[8];
      var items = [];
      var buf = [];
      for (var i = hi + 2; i < lines.length; i++) {
        var l = lines[i];
        if (l === "訂單進度" || l === "用戶訊息" || l === "管理訂單") break;
        if (/^NT\$[\d,]+$/.test(l)) {
          if (buf.length) items.push([buf[0], +l.replace(/[^\d]/g, ""), buf.indexOf("預購") >= 0 ? 1 : 0, buf.indexOf("組合包") >= 0 ? 1 : 0]);
          buf = [];
        } else buf.push(l);
      }
      // 第一行是買家姓名；後面的電話、取貨門市、末五碼刻意不讀
      return [m[1], at, lines[0], +m[9].replace(/,/g, ""), m[10] ? +m[10].replace(/,/g, "") : 0, lines[hi + 1], tab, items];
    });
  }

  function loadTab(tab) {
    return new Promise(function (resolve, reject) {
      var f = document.createElement("iframe");
      // 要有實際大小才算得出 innerText 的換行，所以放在畫面外而不是 display:none
      f.style.cssText = "position:fixed;left:-10000px;top:0;width:1280px;height:900px;border:0;visibility:hidden";
      f.src = "/admin/orders?tab=" + tab + "&_lxsync=" + Date.now();
      var started = Date.now();
      f.onload = function () {
        (function poll() {
          try {
            var doc = f.contentDocument;
            var main = doc && doc.querySelector("main");
            var ready = main && /(待處理|已完成|已取消) \(\d+\)/.test(main.innerText);
            if (ready) {
              // 等一下讓卡片渲染完
              setTimeout(function () {
                try {
                  var rows = parseDoc(doc, tab);
                  f.remove();
                  resolve(rows);
                } catch (e) {
                  f.remove();
                  reject(e);
                }
              }, 600);
              return;
            }
          } catch (e) {
            f.remove();
            return reject(e);
          }
          if (Date.now() - started > 15000) {
            f.remove();
            return reject(new Error("官網訂單頁載入逾時，請確認已登入官網後台"));
          }
          setTimeout(poll, 300);
        })();
      };
      document.body.appendChild(f);
    });
  }

  // ── 商品清單（課程、書籍、優惠碼） ──
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }
  // 打開一個後台頁面（隱藏 iframe），等 main 裡出現 readyText 才回傳 iframe
  function openFrame(url, readyText) {
    return new Promise(function (resolve, reject) {
      var f = document.createElement("iframe");
      f.style.cssText = "position:fixed;left:-10000px;top:0;width:1280px;height:900px;border:0;visibility:hidden";
      f.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "_lxsync=" + Date.now();
      var started = Date.now();
      f.onload = function () {
        (function poll() {
          try {
            var main = f.contentDocument && f.contentDocument.querySelector("main");
            if (main && main.innerText.indexOf(readyText) >= 0) return setTimeout(function () { resolve(f); }, 600);
          } catch (e) {
            f.remove();
            return reject(e);
          }
          if (Date.now() - started > 15000) {
            f.remove();
            return reject(new Error("官網頁面載入逾時：" + url));
          }
          setTimeout(poll, 300);
        })();
      };
      document.body.appendChild(f);
    });
  }
  function linesOf(el) {
    return el.innerText.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function price(text) {
    var m = /NT\$([\d,]+)/.exec(text);
    return m ? +m[1].replace(/,/g, "") : null;
  }
  async function clickTab(f, label) {
    var b = Array.prototype.find.call(f.contentDocument.querySelectorAll("button"), function (x) { return x.textContent.trim() === label; });
    if (!b) throw new Error("找不到「" + label + "」分頁（官網可能改版）");
    b.click();
    await sleep(1200);
  }

  async function readCourses() {
    var f = await openFrame("/admin/courses", "新增課程");
    var L = linesOf(f.contentDocument.querySelector("main"));
    f.remove();
    var out = [];
    for (var i = 0; i < L.length; i++) {
      if (!/^NT\$[\d,]+$/.test(L[i])) continue;
      // 官網卡片的「課程設定（上課資訊・常見問題・首頁・學員）→」連結有時會黏在課名後面，去掉
      var name = L[i - 1].replace(/\s*課程設定（[^）]*）\s*→?\s*$/, "");
      var j = i - 1;
      while (j > 0 && L[j] !== "線上課程" && L[j] !== "小班家教") j--;
      if (j <= 0) continue;
      out.push([name, L[j] === "小班家教" ? "tutoring" : "online", L[j - 1], price(L[i])]);
    }
    return out;
  }

  var STATUS_RE = /^(.+?)(販售中|預購|已停售|停售|已下架|下架)(最划算)?$/;
  async function readBooks() {
    var f = await openFrame("/admin/products", "本單品");
    var doc = f.contentDocument;
    var products = [];
    Array.prototype.forEach.call(doc.querySelectorAll("main a[href^='/admin/products/']"), function (a) {
      // 往上找到只包含一個商品的卡片（卡片裡剛好出現一次「本單品」）
      var card = a;
      while (card && ((card.innerText || "").match(/本單品/g) || []).length !== 1) card = card.parentElement;
      if (!card) return;
      var L = linesOf(card);
      if (L.length >= 2 && !products.some(function (p) { return p.href === a.getAttribute("href"); }))
        products.push({ href: a.getAttribute("href"), name: L[0], type: L[1] });
    });
    f.remove();
    if (!products.length) throw new Error("讀不到書籍清單（官網可能改版）");
    var out = [];
    for (var k = 0; k < products.length; k++) {
      var p = products[k];
      say("正在讀書籍清單（" + (k + 1) + "/" + products.length + "）…");
      var pf = await openFrame(p.href, "單品與組合包");
      await clickTab(pf, "單品與組合包");
      var L = linesOf(pf.contentDocument.querySelector("main"));
      pf.remove();
      var subject = p.name.replace(/先修課程$/, "");
      var calendar = p.type === "行事曆";
      var section = "";
      for (var i = 0; i < L.length; i++) {
        if (L[i].indexOf("單品（") === 0) section = "item";
        else if (L[i].indexOf("組合包（") === 0) section = "bundle";
        var m = STATUS_RE.exec(L[i]);
        if (!section || !m || !L[i + 1] || L[i + 1].indexOf("NT$") !== 0) continue;
        var itemName = m[1].trim();
        var v = price(L[i + 1]);
        if (section === "bundle") out.push([subject + " " + itemName, "bundle", v]);
        else if (calendar) out.push([p.name + "（" + itemName + "）", "notebook", v]);
        else out.push([itemName, itemName.indexOf("刷題本") >= 0 ? "workbook" : "book", v]);
      }
    }
    return out;
  }

  async function readCoupons() {
    var f = await openFrame("/admin/pricing", "方案定價");
    await clickTab(f, "優惠碼");
    var L = linesOf(f.contentDocument.querySelector("main"));
    f.remove();
    var out = [];
    for (var i = 0; i < L.length; i++) {
      var pct = /^(\d+(?:\.\d+)?)% 折扣$/.exec(L[i] || "");
      if (!pct) continue;
      var code = L[i - 2];
      var active = L[i - 1] === "啟用中";
      var until = /~\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(L[i + 1] || "");
      if (code && /^[A-Za-z0-9_-]+$/.test(code)) out.push([code, +pct[1] / 100, until ? until[1] : null, active]);
    }
    return out;
  }

  (async function run() {
    try {
      var all = [];
      for (var i = 0; i < TABS.length; i++) {
        say("正在讀官網訂單（" + (i + 1) + "/" + TABS.length + "）…");
        all = all.concat(await loadTab(TABS[i]));
      }
      // 同一張訂單出現兩次時保留最後一次
      var byNo = {};
      all.forEach(function (o) { byNo[o[0]] = o; });
      var orders = Object.keys(byNo).map(function (k) { return byNo[k]; });
      say("正在讀課程清單…");
      var catalog = { courses: await readCourses(), books: await readBooks(), coupons: [] };
      say("正在讀優惠碼…");
      catalog.coupons = await readCoupons();
      say("讀到 " + orders.length + " 張訂單、" + catalog.courses.length + " 門課、" + catalog.books.length + " 項書籍、" + catalog.coupons.length + " 組優惠碼，正在送到記帳系統…");
      var res = await fetch(cfg.api.replace(/\/$/, "") + "/api/web-orders/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Sync-Key": cfg.key },
        body: JSON.stringify({ orders: orders, catalog: catalog }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || "記帳系統回應錯誤（" + res.status + "）");
      say("✓ 已同步 " + data.count + " 張訂單和商品清單，正在回到記帳系統…");
      setTimeout(function () {
        if (cfg.back) location.href = cfg.back;
        else box.remove();
      }, 1200);
    } catch (e) {
      say("同步失敗：" + (e && e.message ? e.message : e) + "<br><small>可以再點一次書籤；一直失敗請找管理員。</small>", true);
    }
  })();
})();
