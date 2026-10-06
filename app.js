/* Farmer ID Pro Admin v5.2 */
(function () {
  "use strict";
  let auth, db;
  let allUsers = {}, allTokenReqs = {}, allDists = {}, allLogs = {}, allPass = {}, allExpenses = {}, settings = {};
  let incomeChart = null;
  const pageState = { ret: 1, tok: 1, log: 1, pass: 1, inact: 1 };
  const PAGE = { ret: 50, tok: 50, log: 50, pass: 50, inact: 10 };

  const $ = (id) => document.getElementById(id);
  const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  const show = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtDate = (t) => (t ? new Date(t).toLocaleString("en-IN") : "—");
  const daysAgo = (t) => (!t ? 9999 : Math.floor((Date.now() - t) / 86400000));

  function initFirebase() {
    if (!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey) throw new Error("firebase-config missing");
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.database();
  }
  async function fbGet(path) {
    const s = await db.ref(path).once("value");
    return s.val();
  }
  async function safeGet(path) {
    try { return await fbGet(path); } catch (e) { console.warn(path, e); return null; }
  }
  async function fbSet(path, data) { await db.ref(path).set(data); return true; }
  async function fbUpdate(path, data) { await db.ref(path).update(data); return true; }

  function renderPager(elId, page, total, perPage, onPage) {
    const el = $(elId);
    if (!el) return;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const p = Math.min(Math.max(1, page), pages);
    el.innerHTML = `<span>Total: <b>${total}</b> · Page ${p}/${pages}</span>
      <button class="btn btn-sm" data-p="prev" ${p <= 1 ? "disabled" : ""}>Prev</button>
      <button class="btn btn-sm" data-p="next" ${p >= pages ? "disabled" : ""}>Next</button>`;
    el.onclick = (e) => {
      const b = e.target.closest("button[data-p]");
      if (!b || b.disabled) return;
      onPage(b.dataset.p === "next" ? p + 1 : p - 1);
    };
  }

  // Auth
  $("btnLogin").onclick = async () => {
    const err = $("loginError");
    show(err, false);
    try {
      initFirebase();
      await auth.signInWithEmailAndPassword($("loginEmail").value.trim(), $("loginPass").value);
    } catch (e) {
      if (err) { err.textContent = e.message || String(e); show(err, true); }
    }
  };
  $("loginPass").onkeydown = (e) => { if (e.key === "Enter") $("btnLogin").click(); };
  $("btnLogout").onclick = async () => { try { await auth.signOut(); } catch (e) {} };

  document.querySelectorAll(".nav").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".nav").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab").forEach((t) => t.classList.add("hidden"));
      show($("tab-" + btn.dataset.tab), true);
      setText("pageTitle", (btn.textContent || "").replace(/^\S+\s/, ""));
      const app = $("app");
      if (app) app.classList.remove("sidebar-open");
      refreshTab(btn.dataset.tab);
    };
  });
  $("btnRefresh").onclick = () => loadAll();
  if ($("btnMenu")) $("btnMenu").onclick = () => $("app") && $("app").classList.toggle("sidebar-open");

  function refreshTab(tab) {
    if (tab === "dashboard") renderDashboard();
    if (tab === "retailers") renderRetailers();
    if (tab === "pending") renderPending();
    if (tab === "tokens") renderTokens();
    if (tab === "distributors") renderDists();
    if (tab === "logs") renderLogs();
    if (tab === "passreq") renderPass();
    if (tab === "wallet") renderWallet();
    if (tab === "adduser") fillDistSelects();
    if (tab === "settings") fillSettings();
  }

  async function loadAll() {
    try {
      const [u, tq, d, l, p, s, e, inc] = await Promise.all([
        safeGet("users"), safeGet("token_requests"), safeGet("distributors"),
        safeGet("usage_logs"), safeGet("password_requests"), safeGet("settings"),
        safeGet("portal_expenses"), safeGet("admin_income")
      ]);
      allUsers = u || {}; allTokenReqs = tq || {}; allDists = d || {};
      allLogs = l || {}; allPass = p || {}; settings = s || {};
      allExpenses = e || {}; window._adminIncome = inc || {};
      setText("dbStatus", "DB Connected");
      const st = $("dbStatus"); if (st) st.className = "badge ok";
      const active = document.querySelector(".nav.active");
      refreshTab(active ? active.dataset.tab : "dashboard");
    } catch (e) {
      setText("dbStatus", "Error: " + (e.message || e));
      const st = $("dbStatus"); if (st) st.className = "badge err";
    }
  }

  function inactiveDays() { return Math.max(1, parseInt(settings.inactiveDays, 10) || 7); }
  function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function incomeEntries() {
    const list = [];
    Object.values(allTokenReqs || {}).forEach((r) => {
      if (!r || r.status !== "approved") return;
      list.push({ amount: Number(r.totalAmount) || 0, ts: r.finalApprovedAt || r.approvedAt || r.createdAt || 0, type: "sale", note: (r.userName || "") + " UTR " + (r.utr || "") });
    });
    Object.values(window._adminIncome || {}).forEach((x) => {
      if (!x) return;
      list.push({ amount: Number(x.amount) || 0, ts: x.timestamp || 0, type: x.type || "manual", note: x.userId || "" });
    });
    return list;
  }
  function sumInRange(list, from, to) {
    return list.filter((x) => x.ts >= from && x.ts < to).reduce((s, x) => s + (x.amount || 0), 0);
  }
  function totalExpense() {
    return Object.values(allExpenses || {}).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  }

  function waNeverMsg(u) {
    return `Namaste ${u.name || ""} ji\n\nAapki Farmer ID Generator ID active hai\n\nAapne abhi tak ek bhi card generate nahi kiya hai.\n\nYadi koi pareshani / problem hai to is number par message karein.\nHum help karenge.\n\nDhanyavad!`;
  }
  function waInactiveMsg(u, day) {
    return `Namaste ${u.name || ""} ji\n\nAapki Farmer ID Generator ID active hai\n\nLekin aap ${day} din se inactive hain (last login / work nahi dikha).\n\nKripya active ho jaiye aur cards generate karna shuru karein.\n\nKoi problem ho to is number par message karein — hum help karenge.\n\nDhanyavad!`;
  }

  function renderDashboard() {
    const users = Object.values(allUsers || {}).filter(Boolean);
    const reqs = Object.values(allTokenReqs || {}).filter(Boolean);
    const idays = inactiveDays();
    const inactiveList = users.filter((u) => u.status === "active" && daysAgo(u.lastSeenAt || u.lastUsed) >= idays);
    const now = Date.now();
    const day0 = startOfDay(now);
    const d = new Date();
    const month0 = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const year0 = new Date(d.getFullYear(), 0, 1).getTime();
    const inc = incomeEntries();
    const today = sumInRange(inc, day0, day0 + 86400000);
    const month = sumInRange(inc, month0, now + 1);
    const year = sumInRange(inc, year0, now + 1);
    const exp = totalExpense();
    const gross = inc.reduce((s, x) => s + (x.amount || 0), 0);
    setText("sToday", "₹" + today);
    setText("sMonth", "₹" + month);
    setText("sYear", "₹" + year);
    setText("sExpense", "₹" + exp);
    setText("sProfit", "₹" + (gross - exp));
    setText("sTokPend", String(reqs.filter((r) => (r.status || "pending") === "pending").length));
    if ($("pendingSummary")) {
      $("pendingSummary").innerHTML = `Token pending: <b>${reqs.filter((r) => (r.status || "pending") === "pending").length}</b> · Temp: <b>${reqs.filter((r) => r.status === "temp_approved").length}</b> · Users: <b>${users.filter((u) => u.status === "pending").length}</b>`;
    }
    const top = users.slice().sort((a, b) => (b.totalUsed || 0) - (a.totalUsed || 0)).slice(0, 8);
    if ($("topRetailers")) {
      $("topRetailers").innerHTML = top.length ? "<ol style='margin-left:18px'>" + top.map((u) => `<li><b>${esc(u.name)}</b> — ${u.totalUsed || 0}</li>`).join("") + "</ol>" : "—";
    }
    const months = {};
    inc.forEach((r) => {
      if (!r.ts) return;
      const dt = new Date(r.ts);
      const key = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0");
      months[key] = (months[key] || 0) + (r.amount || 0);
    });
    const labels = Object.keys(months).sort().slice(-6);
    const data = labels.map((k) => months[k]);
    const ctx = $("chartIncome");
    if (ctx && typeof Chart !== "undefined") {
      if (incomeChart) incomeChart.destroy();
      incomeChart = new Chart(ctx, {
        type: "line",
        data: { labels, datasets: [{ data, borderColor: "#34d399", backgroundColor: "rgba(52,211,153,.12)", fill: true, tension: 0.3, pointRadius: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { display: false } }, y: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "#334155" } } } }
      });
    }
    // expenses mini
    const et = $("expTable");
    if (et) {
      et.innerHTML = "";
      Object.entries(allExpenses || {}).sort((a, b) => String(b[1].date || "").localeCompare(String(a[1].date || ""))).slice(0, 20).forEach(([id, x]) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${esc(x.date)}</td><td>${esc(x.title)}</td><td>₹${x.amount}</td><td><button class="btn btn-sm btn-danger" data-eid="${esc(id)}">Del</button></td>`;
        et.appendChild(tr);
      });
      et.onclick = async (e) => {
        const b = e.target.closest("button[data-eid]");
        if (!b || !confirm("Delete?")) return;
        await fbSet("portal_expenses/" + b.dataset.eid, null);
        await loadAll();
      };
    }
    // inactive 10/page
    const sorted = inactiveList.sort((a, b) => (a.lastSeenAt || 0) - (b.lastSeenAt || 0));
    const total = sorted.length;
    const per = PAGE.inact;
    renderPager("inactPager", pageState.inact, total, per, (np) => { pageState.inact = np; renderDashboard(); });
    const pages = Math.max(1, Math.ceil(total / per));
    pageState.inact = Math.min(pageState.inact, pages);
    const slice = sorted.slice((pageState.inact - 1) * per, pageState.inact * per);
    const tb = $("inactiveTable");
    if (!tb) return;
    tb.innerHTML = "";
    slice.forEach((u) => {
      const used = u.totalUsed || 0;
      const day = daysAgo(u.lastSeenAt || u.lastUsed);
      const kind = used === 0 ? "Never used" : "Inactive " + day + "d";
      const msg = used === 0 ? waNeverMsg(u) : waInactiveMsg(u, day);
      const mob = String(u.mobile || "").replace(/\D/g, "").slice(-10);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${esc(u.name)}</td><td>${esc(u.mobile)}</td><td>${esc(u.lastVersion || "—")}</td>
        <td>${fmtDate(u.lastSeenAt || u.lastUsed)}</td><td>${used}</td><td>${kind}</td>
        <td><a class="btn btn-sm" target="_blank" href="https://wa.me/91${mob}?text=${encodeURIComponent(msg)}">WA</a></td>`;
      tb.appendChild(tr);
    });
    if (!slice.length) tb.innerHTML = '<tr><td colspan="7" class="muted">None</td></tr>';
  }

  function distName(id) {
    return id && allDists[id] ? (allDists[id].name || allDists[id].mobile) : "—";
  }

  function renderRetailers() {
    const q = (($("retSearch") && $("retSearch").value) || "").toLowerCase();
    const st = ($("retStatus") && $("retStatus").value) || "";
    const tokF = ($("retTokFilter") && $("retTokFilter").value) || "";
    const sort = ($("retSort") && $("retSort").value) || "new";
    let list = Object.entries(allUsers || {}).filter(([, u]) => u && u.status !== "pending");
    if (st) list = list.filter(([, u]) => u.status === st);
    if (tokF === "zero") list = list.filter(([, u]) => !(u.tokens > 0));
    if (tokF === "never") list = list.filter(([, u]) => !(u.totalUsed > 0));
    if (tokF === "has") list = list.filter(([, u]) => (u.tokens || 0) > 0);
    if (q) list = list.filter(([, u]) => (u.name || "").toLowerCase().includes(q) || String(u.mobile || "").includes(q) || (u.address || "").toLowerCase().includes(q));
    list.sort((a, b) => {
      const A = a[1], B = b[1];
      if (sort === "name") return (A.name || "").localeCompare(B.name || "");
      if (sort === "tokens") return (B.tokens || 0) - (A.tokens || 0);
      if (sort === "used") return (B.totalUsed || 0) - (A.totalUsed || 0);
      if (sort === "old") return (A.createdAt || 0) - (B.createdAt || 0);
      return (B.createdAt || 0) - (A.createdAt || 0);
    });
    const total = list.length;
    const per = PAGE.ret;
    renderPager("retPager", pageState.ret, total, per, (np) => { pageState.ret = np; renderRetailers(); });
    const pages = Math.max(1, Math.ceil(total / per));
    pageState.ret = Math.min(pageState.ret, pages);
    list = list.slice((pageState.ret - 1) * per, pageState.ret * per);
    const tbody = $("retTable");
    if (!tbody) return;
    tbody.innerHTML = "";
    list.forEach(([uid, u]) => {
      const rate = u.tokenCost != null && u.tokenCost !== "" ? u.tokenCost : "def";
      const pill = u.status === "active" ? "pill-ok" : u.status === "blocked" ? "pill-bad" : "pill-pend";
      const tr = document.createElement("tr");
      if (!(u.totalUsed > 0)) tr.className = "row-never";
      else if (!(u.tokens > 0)) tr.className = "row-zero";
      tr.innerHTML = `<td><b>${esc(u.name)}</b></td><td>${esc(u.mobile)}</td>
        <td class="muted">${esc((u.address || "").slice(0, 24))}</td><td><b>${u.tokens || 0}</b></td><td>${rate}</td>
        <td><span class="pill ${pill}">${esc(u.status)}</span></td><td>${esc(distName(u.distributorId))}</td>
        <td class="muted">${fmtDate(u.lastSeenAt || u.lastUsed)}</td><td>${u.totalUsed || 0}</td>
        <td><div class="dd"><button type="button" class="dd-btn" data-dd="1">⋮</button>
          <div class="dd-menu">
            <button type="button" data-a="edit" data-id="${esc(uid)}">Edit</button>
            <button type="button" data-a="tok" data-id="${esc(uid)}">Credit tokens</button>
            <button type="button" data-a="deb" data-id="${esc(uid)}">Debit tokens</button>
            <button type="button" data-a="pass" data-id="${esc(uid)}">Show password</button>
            <button type="button" data-a="wa" data-id="${esc(uid)}">WA password</button>
            <button type="button" data-a="stmt" data-id="${esc(uid)}">Statement</button>
            <button type="button" data-a="rate" data-id="${esc(uid)}">Rate</button>
            <button type="button" data-a="refill" data-id="${esc(uid)}">${u.walletRefillDisabled ? "Refill ON" : "Refill OFF"}</button>
            <button type="button" data-a="block" data-id="${esc(uid)}">${u.status === "blocked" ? "Unblock" : "Block"}</button>
          </div></div></td>`;
      tbody.appendChild(tr);
    });
    if (!list.length) tbody.innerHTML = '<tr><td colspan="10" class="muted">No data</td></tr>';
    tbody.onclick = retailerActions;
  }

  async function retailerActions(e) {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    const id = b.dataset.id;
    const u = allUsers[id];
    if (!u) return;
    const a = b.dataset.a;
    if (a === "edit") {
      $("edId").value = id;
      $("edName").value = u.name || "";
      $("edMobile").value = u.mobile || "";
      $("edPass").value = u.password || "";
      $("edAddr").value = u.address || "";
      $("edRate").value = u.tokenCost != null ? u.tokenCost : "";
      $("edDist").value = u.distributorId || "";
      $("edStatus").value = u.status || "active";
      $("edRefillOff").checked = !!u.walletRefillDisabled;
      $("modalEdit").classList.remove("hidden");
      return;
    }
    if (a === "tok") {
      const qty = parseInt(prompt("Credit tokens:", "10") || "0", 10);
      if (!qty) return;
      const r = parseFloat(prompt("Rate ₹ / token (income):", "10") || "0") || 0;
      const tokens = (u.tokens || 0) + qty;
      const h = Array.isArray(u.tokenHistory) ? u.tokenHistory.slice() : [];
      h.push({ type: "credit", amount: qty, reason: "Admin @₹" + r, timestamp: Date.now(), balanceAfter: tokens });
      await fbUpdate("users/" + id, { tokens, tokenHistory: h });
      if (r > 0) await fbSet("admin_income/inc_" + Date.now(), { amount: qty * r, type: "manual_credit", userId: id, qty, rate: r, timestamp: Date.now() });
    } else if (a === "deb") {
      const qty = parseInt(prompt("Debit tokens:", "1") || "0", 10);
      if (!qty || (u.tokens || 0) < qty) return alert("Invalid / insufficient");
      const rf = parseFloat(prompt("Refund ₹ from income (0=skip):", "0") || "0") || 0;
      const tokens = (u.tokens || 0) - qty;
      const h = Array.isArray(u.tokenHistory) ? u.tokenHistory.slice() : [];
      h.push({ type: "debit", amount: qty, reason: "Admin refund ₹" + rf, timestamp: Date.now(), balanceAfter: tokens });
      await fbUpdate("users/" + id, { tokens, tokenHistory: h });
      if (rf > 0) await fbSet("admin_income/inc_" + Date.now(), { amount: -rf, type: "refund", userId: id, timestamp: Date.now() });
    } else if (a === "pass") { alert("Password: " + (u.password || "")); return; }
    else if (a === "wa") {
      const mob = String(u.mobile || "").replace(/\D/g, "").slice(-10);
      const msg = `Namaste ${u.name || ""} ji\nMobile: ${u.mobile}\nPassword: ${u.password || ""}\nGroup: ${settings.waGroupLink || ""}`;
      if (mob) window.open("https://wa.me/91" + mob + "?text=" + encodeURIComponent(msg), "_blank");
      return;
    } else if (a === "stmt") { showStatement(id, u); return; }
    else if (a === "rate") {
      const n = prompt("Rate (blank=default):", u.tokenCost != null ? u.tokenCost : "");
      if (n == null) return;
      await fbUpdate("users/" + id, { tokenCost: String(n).trim() === "" ? null : parseInt(n, 10) });
    } else if (a === "refill") await fbUpdate("users/" + id, { walletRefillDisabled: !u.walletRefillDisabled });
    else if (a === "block") await fbUpdate("users/" + id, { status: u.status === "blocked" ? "active" : "blocked" });
    await loadAll();
  }

  ["retSearch", "retStatus", "retTokFilter", "retSort"].forEach((id) => {
    if ($(id)) $(id).oninput = $(id).onchange = () => { pageState.ret = 1; renderRetailers(); };
  });

  function renderPending() {
    const tbody = $("pendTable");
    if (!tbody) return;
    tbody.innerHTML = "";
    Object.entries(allUsers || {}).filter(([, u]) => u && u.status === "pending")
      .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0)).forEach(([uid, u]) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${esc(u.name)}</td><td>${esc(u.mobile)}</td><td class="muted">${esc((u.address || "").slice(0, 30))}</td>
          <td>${fmtDate(u.createdAt)}</td>
          <td><button class="btn btn-sm btn-primary" data-a="ok" data-id="${esc(uid)}">Approve+WA</button>
          <button class="btn btn-sm btn-danger" data-a="del" data-id="${esc(uid)}">Del</button></td>`;
        tbody.appendChild(tr);
      });
    tbody.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const id = b.dataset.id;
      const u = allUsers[id];
      if (b.dataset.a === "ok") {
        const free = parseInt(prompt("Free tokens?", "2") || "2", 10) || 0;
        await fbUpdate("users/" + id, { status: "active", tokens: free, freeTokens: free, approvedAt: Date.now(), finalApprovedAt: Date.now(), awaitingFinalApprove: false });
        const tmpl = settings.approveMessage || `Namaste {name} ji\nAapka Farmer ID Generator account ready hai\nLogin Mobile: {mobile}\nPassword: {password}\nTokens: {tokens}\nInstall Guide Group:\n{group}\nUsage Guide Video:\n{video}\n\nDhanyavad!`;
        const msg = tmpl.replace(/\{name\}/g, u.name || "").replace(/\{mobile\}/g, u.mobile || "").replace(/\{password\}/g, u.password || "").replace(/\{tokens\}/g, String(free)).replace(/\{group\}/g, settings.waGroupLink || "").replace(/\{video\}/g, settings.videoGuideLink || "");
        const mob = String(u.mobile || "").replace(/\D/g, "").slice(-10);
        if (mob) window.open("https://wa.me/91" + mob + "?text=" + encodeURIComponent(msg), "_blank");
      } else if (confirm("Delete?")) await fbSet("users/" + id, null);
      await loadAll();
    };
  }

  async function creditUser(userId, qty, reason) {
    const user = allUsers[userId];
    if (!user) throw new Error("User missing");
    const tokens = (user.tokens || 0) + qty;
    const history = Array.isArray(user.tokenHistory) ? user.tokenHistory.slice() : [];
    history.push({ type: qty >= 0 ? "credit" : "debit", amount: Math.abs(qty), reason, timestamp: Date.now(), balanceAfter: tokens });
    await fbUpdate("users/" + userId, { tokens, tokenHistory: history });
  }

  function renderTokens() {
    const filt = ($("tokFilter") && $("tokFilter").value) || "";
    let list = Object.entries(allTokenReqs || {}).filter(([, r]) => r);
    if (filt) list = list.filter(([, r]) => (r.status || "pending") === filt);
    list.sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    const total = list.length;
    renderPager("tokPager", pageState.tok, total, PAGE.tok, (np) => { pageState.tok = np; renderTokens(); });
    const pages = Math.max(1, Math.ceil(total / PAGE.tok));
    pageState.tok = Math.min(pageState.tok, pages);
    list = list.slice((pageState.tok - 1) * PAGE.tok, pageState.tok * PAGE.tok);
    const tbody = $("tokTable");
    if (!tbody) return;
    tbody.innerHTML = "";
    list.forEach(([rid, r]) => {
      const st = r.status || "pending";
      const pill = st === "approved" ? "pill-ok" : st === "temp_approved" ? "pill-temp" : st === "rejected" ? "pill-bad" : "pill-pend";
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="muted">${fmtDate(r.createdAt)}</td><td>${esc(r.userName)}</td><td>${esc(r.userMobile)}</td>
        <td><b>${r.amount || 0}</b></td><td>₹${r.totalAmount || 0}</td><td><code>${esc(r.utr || "—")}</code></td>
        <td><span class="pill ${pill}">${esc(st)}</span></td>
        <td>
          <button class="btn btn-sm" data-a="edit" data-id="${esc(rid)}">Edit</button>
          ${st === "pending" || st === "temp_approved" ? `<button class="btn btn-sm btn-primary" data-a="final" data-id="${esc(rid)}">Final</button>` : ""}
          ${st === "pending" ? `<button class="btn btn-sm btn-warn" data-a="temp" data-id="${esc(rid)}">Temp</button>` : ""}
          <button class="btn btn-sm btn-danger" data-a="rej" data-id="${esc(rid)}">Reject</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = async (e) => {
      const b = e.target.closest("button[data-a]");
      if (!b) return;
      const rid = b.dataset.id;
      const r = allTokenReqs[rid];
      if (!r) return;
      if (b.dataset.a === "edit") {
        $("teId").value = rid;
        $("teQty").value = r.amount || 0;
        $("teAmt").value = r.totalAmount || 0;
        $("teUtr").value = r.utr || "";
        $("teStatus").value = r.status || "pending";
        $("modalTokEdit").classList.remove("hidden");
        return;
      }
      if (b.dataset.a === "temp" && (r.status || "pending") === "pending") {
        await creditUser(r.userId, parseInt(r.amount, 10) || 0, "Temp approve");
        await fbUpdate("token_requests/" + rid, { status: "temp_approved", tempApprovedAt: Date.now() });
      } else if (b.dataset.a === "final") {
        if ((r.status || "pending") === "pending") await creditUser(r.userId, parseInt(r.amount, 10) || 0, "Final");
        await fbUpdate("token_requests/" + rid, { status: "approved", finalApprovedAt: Date.now(), approvedAt: Date.now() });
      } else if (b.dataset.a === "rej") {
        if (r.status === "temp_approved" || r.status === "approved") await creditUser(r.userId, -(parseInt(r.amount, 10) || 0), "Reject clawback");
        await fbUpdate("token_requests/" + rid, { status: "rejected", rejectedAt: Date.now() });
      }
      await loadAll();
    };
  }
  if ($("tokFilter")) $("tokFilter").onchange = () => { pageState.tok = 1; renderTokens(); };

  function renderDists() {
    const tbody = $("distTable");
    if (!tbody) return;
    tbody.innerHTML = "";
    Object.entries(allDists || {}).forEach(([did, d]) => {
      if (!d) return;
      const count = Object.values(allUsers || {}).filter((u) => u && u.distributorId === did).length;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${esc(d.name)}</td><td>${esc(d.mobile)}</td><td><b>${d.tokens || 0}</b></td>
        <td>${d.totalCommission || 0}</td><td>${count}</td><td>${esc(d.status || "active")}</td>
        <td>
          <button class="btn btn-sm" data-a="add" data-id="${esc(did)}">+Tok</button>
          <button class="btn btn-sm" data-a="sub" data-id="${esc(did)}">−Tok</button>
          <button class="btn btn-sm" data-a="pass" data-id="${esc(did)}">Pass</button>
          <button class="btn btn-sm btn-danger" data-a="block" data-id="${esc(did)}">${d.status === "blocked" ? "Unblock" : "Block"}</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const id = b.dataset.id;
      const d = allDists[id];
      if (!d) return;
      if (b.dataset.a === "add") {
        const qty = parseInt(prompt("Add tokens:", "10") || "0", 10);
        if (!qty) return;
        const rate = parseFloat(prompt("Amount ₹ (optional income note, 0=skip):", "0") || "0") || 0;
        const tokens = (d.tokens || 0) + qty;
        const h = Array.isArray(d.tokenHistory) ? d.tokenHistory.slice() : [];
        h.push({ type: "credit", amount: qty, reason: "Admin add", rate, timestamp: Date.now(), balanceAfter: tokens });
        await fbUpdate("distributors/" + id, { tokens, tokenHistory: h.slice(-50) });
        if (rate > 0) await fbSet("admin_income/inc_" + Date.now(), { amount: rate, type: "dist_topup", userId: id, timestamp: Date.now() });
      } else if (b.dataset.a === "sub") {
        const qty = parseInt(prompt("Debit tokens:", "1") || "0", 10);
        if (!qty || (d.tokens || 0) < qty) return alert("Invalid");
        const tokens = (d.tokens || 0) - qty;
        const h = Array.isArray(d.tokenHistory) ? d.tokenHistory.slice() : [];
        h.push({ type: "debit", amount: qty, reason: "Admin debit", timestamp: Date.now(), balanceAfter: tokens });
        await fbUpdate("distributors/" + id, { tokens, tokenHistory: h.slice(-50) });
      } else if (b.dataset.a === "pass") {
        const np = prompt("New password:", d.password || "");
        if (np == null || !np) return;
        await fbUpdate("distributors/" + id, { password: np });
        alert("Password updated");
      } else if (b.dataset.a === "block") {
        await fbUpdate("distributors/" + id, { status: d.status === "blocked" ? "active" : "blocked" });
      }
      await loadAll();
    };
  }

  if ($("btnAddDist")) $("btnAddDist").onclick = async () => {
    const name = $("dName").value.trim();
    const mobile = $("dMobile").value.replace(/\D/g, "").slice(0, 10);
    const password = $("dPass").value;
    if (!name || mobile.length < 10 || !password) return alert("Fill all");
    const id = "d_" + mobile;
    await fbSet("distributors/" + id, { name, mobile, password, tokens: 0, totalCommission: 0, status: "active", createdAt: Date.now(), tokenHistory: [] });
    alert("Created");
    await loadAll();
  };

  function renderLogs() {
    const q = (($("logSearch") && $("logSearch").value) || "").toLowerCase();
    const sort = ($("logSort") && $("logSort").value) || "new";
    let list = Object.entries(allLogs || {}).map(([k, v]) => ({ id: k, ...v })).filter((x) => x.timestamp);
    if (q) list = list.filter((x) => (x.userName || "").toLowerCase().includes(q) || String(x.userMobile || "").includes(q) || String(x.cscUserId || "").includes(q) || String(x.farmerId || "").includes(q));
    list.sort((a, b) => sort === "old" ? (a.timestamp || 0) - (b.timestamp || 0) : (b.timestamp || 0) - (a.timestamp || 0));
    const total = list.length;
    renderPager("logPager", pageState.log, total, PAGE.log, (np) => { pageState.log = np; renderLogs(); });
    const pages = Math.max(1, Math.ceil(total / PAGE.log));
    pageState.log = Math.min(pageState.log, pages);
    list = list.slice((pageState.log - 1) * PAGE.log, pageState.log * PAGE.log);
    const tbody = $("logTable");
    if (!tbody) return;
    tbody.innerHTML = "";
    list.forEach((x) => {
      const place = [x.taluka, x.district, x.state].filter(Boolean).join(", ");
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="muted">${fmtDate(x.timestamp)}</td>
        <td>${esc(x.userName)} <span class="muted">${esc(x.userMobile)}</span></td>
        <td>${esc(x.name)} <code>${esc(x.farmerId || "")}</code></td>
        <td><code>${esc(x.cscUserId || "—")}</code></td>
        <td class="muted">${esc(place)}</td><td>${x.tokensLeft ?? "—"}</td><td>${x.costCharged ?? "—"}</td>
        <td><button class="btn btn-sm btn-danger" data-lid="${esc(x.id)}">Del</button></td>`;
      tbody.appendChild(tr);
    });
    if (!list.length) tbody.innerHTML = '<tr><td colspan="8" class="muted">No logs</td></tr>';
    tbody.onclick = async (e) => {
      const b = e.target.closest("button[data-lid]");
      if (!b || !confirm("Delete log?")) return;
      await fbSet("usage_logs/" + b.dataset.lid, null);
      await loadAll();
    };
  }
  if ($("logSearch")) $("logSearch").oninput = () => { pageState.log = 1; renderLogs(); };
  if ($("logSort")) $("logSort").onchange = () => { pageState.log = 1; renderLogs(); };
  if ($("btnClearLogs")) $("btnClearLogs").onclick = async () => {
    if (!confirm("Delete ALL usage logs?")) return;
    await fbSet("usage_logs", null);
    await loadAll();
  };

  function renderPass() {
    let list = Object.entries(allPass || {}).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    const total = list.length;
    renderPager("passPager", pageState.pass, total, PAGE.pass, (np) => { pageState.pass = np; renderPass(); });
    const pages = Math.max(1, Math.ceil(total / PAGE.pass));
    pageState.pass = Math.min(pageState.pass, pages);
    list = list.slice((pageState.pass - 1) * PAGE.pass, pageState.pass * PAGE.pass);
    const tbody = $("passTable");
    if (!tbody) return;
    tbody.innerHTML = "";
    list.forEach(([id, r]) => {
      if (!r) return;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${fmtDate(r.createdAt)}</td><td>${esc(r.mobile)}</td><td>${esc(r.name || "")}</td>
        <td>${esc(r.status || "pending")}</td>
        <td><button class="btn btn-sm btn-danger" data-id="${esc(id)}">Del</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      await fbSet("password_requests/" + b.dataset.id, null);
      await loadAll();
    };
  }

  function renderWallet() {
    const inc = incomeEntries().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const earn = inc.reduce((s, x) => s + (x.amount > 0 ? x.amount : 0), 0);
    const exp = totalExpense();
    setText("wEarn", "₹" + earn);
    setText("wExp", "₹" + exp);
    setText("wNet", "₹" + (inc.reduce((s, x) => s + x.amount, 0) - exp));
    const et = $("earnTable");
    if (et) {
      et.innerHTML = "";
      inc.slice(0, 100).forEach((x) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${fmtDate(x.ts)}</td><td>${esc(x.type)}</td><td style="color:${x.amount < 0 ? "#fca5a5" : "#6ee7b7"}">₹${x.amount}</td><td class="muted">${esc(x.note || "")}</td>`;
        et.appendChild(tr);
      });
    }
    const xt = $("expHistTable");
    if (xt) {
      xt.innerHTML = "";
      Object.entries(allExpenses || {}).sort((a, b) => String(b[1].date || "").localeCompare(String(a[1].date || ""))).forEach(([id, x]) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${esc(x.date)}</td><td>${esc(x.title)}</td><td>₹${x.amount}</td>
          <td><button class="btn btn-sm btn-danger" data-eid="${esc(id)}">Del</button></td>`;
        xt.appendChild(tr);
      });
      xt.onclick = async (e) => {
        const b = e.target.closest("button[data-eid]");
        if (!b || !confirm("Delete?")) return;
        await fbSet("portal_expenses/" + b.dataset.eid, null);
        await loadAll();
      };
    }
  }

  function fillDistSelects() {
    const opts = '<option value="">—</option>' + Object.entries(allDists || {}).map(([id, d]) => `<option value="${esc(id)}">${esc(d.name)} (${esc(d.mobile)})</option>`).join("");
    if ($("arDist")) $("arDist").innerHTML = opts;
    if ($("mapDist")) $("mapDist").innerHTML = opts;
  }
  if ($("btnAddRet")) $("btnAddRet").onclick = async () => {
    const name = $("arName").value.trim();
    const mobile = $("arMobile").value.replace(/\D/g, "").slice(0, 10);
    if (!name || mobile.length < 10) return alert("Name + mobile");
    const uid = "u_" + mobile;
    const rate = $("arRate").value.trim();
    await fbSet("users/" + uid, {
      name, mobile, password: $("arPass").value || "123456", address: $("arAddr").value.trim(),
      tokens: parseInt($("arTokens").value, 10) || 0, status: "active", createdAt: Date.now(), approvedAt: Date.now(),
      distributorId: $("arDist").value || null, tokenCost: rate === "" ? null : parseInt(rate, 10),
      tokenHistory: [], generatedFarmerIds: {}, totalUsed: 0
    });
    alert("Created"); await loadAll();
  };
  if ($("btnMap")) $("btnMap").onclick = async () => {
    const uid = "u_" + $("mapRetMobile").value.replace(/\D/g, "").slice(0, 10);
    if (!allUsers[uid]) return alert("Not found");
    await fbUpdate("users/" + uid, { distributorId: $("mapDist").value || null });
    alert("Mapped"); await loadAll();
  };

  function fillSettings() {
    const s = settings || {};
    const setv = (id, v) => { if ($(id)) $(id).value = v; };
    setv("setAutoPay", s.autoApproveEnabled ? "1" : "0");
    setv("setAutoRet", s.autoTempApproveRetailer ? "1" : "0");
    setv("setTokenCost", s.tokenCost != null ? s.tokenCost : 1);
    setv("setFreeGen", s.freeGenerateEnabled ? "1" : "0");
    setv("setInactiveDays", s.inactiveDays || 7);
    setv("setDistEvery", s.distCommissionEvery || 2);
    setv("setDistGive", s.distCommissionGive != null ? s.distCommissionGive : 1);
    setv("setWa", s.whatsappNumber || "");
    setv("setWaGroup", s.waGroupLink || "");
    setv("setVideo", s.videoGuideLink || "");
    setv("setBuyMsg", s.buyMessage || "");
    setv("setApproveMsg", s.approveMessage || `Namaste {name} ji\nAapka Farmer ID Generator account ready hai\nLogin Mobile: {mobile}\nPassword: {password}\nTokens: {tokens}\nInstall Guide Group:\n{group}\nUsage Guide Video:\n{video}\n\nDhanyavad!`);
    setv("setUpi", s.upiLink || "");
    setv("rate1", s.rate1to5 != null ? s.rate1to5 : 20);
    setv("rate2", s.rate6to10 != null ? s.rate6to10 : 15);
    setv("rate3", s.rate11plus != null ? s.rate11plus : 10);
    setv("rzpEn", s.razorpayEnabled ? "1" : "0");
    setv("rzpKey", s.razorpayKeyId || "");
    setv("setMoreEn", s.moreServiceEnabled ? "1" : "0");
    setv("setMoreUrl", s.moreServiceUrl || "");
  }
  if ($("btnSaveAuto")) $("btnSaveAuto").onclick = async () => {
    await fbUpdate("settings", { autoApproveEnabled: $("setAutoPay").value === "1", autoTempApproveRetailer: $("setAutoRet").value === "1", tokenCost: parseInt($("setTokenCost").value, 10) || 0, freeGenerateEnabled: $("setFreeGen").value === "1", inactiveDays: parseInt($("setInactiveDays").value, 10) || 7 });
    alert("Saved"); await loadAll();
  };
  if ($("btnSaveDistComm")) $("btnSaveDistComm").onclick = async () => {
    await fbUpdate("settings", { distCommissionEvery: parseInt($("setDistEvery").value, 10) || 2, distCommissionGive: parseInt($("setDistGive").value, 10) || 0 });
    alert("Saved"); await loadAll();
  };
  if ($("btnSaveSupport")) $("btnSaveSupport").onclick = async () => {
    await fbUpdate("settings", { whatsappNumber: $("setWa").value.trim(), waGroupLink: $("setWaGroup").value.trim(), videoGuideLink: $("setVideo").value.trim(), buyMessage: $("setBuyMsg").value.trim(), approveMessage: $("setApproveMsg").value.trim(), upiLink: $("setUpi").value.trim() });
    alert("Saved"); await loadAll();
  };
  if ($("btnSaveRates")) $("btnSaveRates").onclick = async () => {
    await fbUpdate("settings", { rate1to5: parseFloat($("rate1").value) || 20, rate6to10: parseFloat($("rate2").value) || 15, rate11plus: parseFloat($("rate3").value) || 10, razorpayEnabled: $("rzpEn").value === "1", razorpayKeyId: $("rzpKey").value.trim(), moreServiceEnabled: $("setMoreEn").value === "1", moreServiceUrl: $("setMoreUrl").value.trim() });
    alert("Saved"); await loadAll();
  };

  // Delete DB / Migrate
  if ($("btnDeleteDB")) $("btnDeleteDB").onclick = async () => {
    if (($("delConfirm").value || "").trim() !== "DELETE") return alert("Type DELETE");
    if (!confirm("PERMANENT delete all data?")) return;
    const paths = ["users", "token_requests", "distributors", "usage_logs", "password_requests", "settings", "portal_expenses", "admin_income", "admins", "services", "service_requests", "service_categories"];
    for (const p of paths) { try { await fbSet(p, null); } catch (e) { console.warn(p, e); } }
    alert("Deleted");
    await loadAll();
  };
  if ($("btnMigrate")) $("btnMigrate").onclick = async () => {
    const url = ($("migUrl").value || "").replace(/\/$/, "");
    if (!url.startsWith("https://")) return alert("Valid target URL");
    if (!confirm("Copy current DB to target?")) return;
    const paths = ["users", "token_requests", "distributors", "usage_logs", "password_requests", "settings", "portal_expenses", "admin_income", "admins"];
    for (const p of paths) {
      const data = await safeGet(p);
      if (data == null) continue;
      const res = await fetch(url + "/" + p + ".json", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) console.warn("migrate fail", p, res.status);
    }
    alert("Migrate attempt done. Target rules must allow write.");
  };

  if ($("btnAddExp")) $("btnAddExp").onclick = async () => {
    const title = $("expTitle").value.trim();
    const amount = parseFloat($("expAmount").value) || 0;
    let date = $("expDate").value || new Date().toISOString().slice(0, 10);
    if (!title || !amount) return alert("Title + amount");
    await fbSet("portal_expenses/exp_" + Date.now(), { title, amount, date, createdAt: Date.now() });
    $("expTitle").value = ""; $("expAmount").value = "";
    await loadAll();
  };

  function exportCsv(name, rows) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows], { type: "text/csv" }));
    a.download = name;
    a.click();
  }
  function downloadUsersCsv() {
    let u = "id,name,mobile,password,tokens,status,address,totalUsed\n";
    Object.entries(allUsers || {}).forEach(([id, x]) => {
      if (!x) return;
      u += [id, x.name, x.mobile, x.password, x.tokens, x.status, x.address, x.totalUsed].map((v) => '"' + String(v ?? "").replace(/"/g, "'") + '"').join(",") + "\n";
    });
    exportCsv("users.csv", u);
  }
  function downloadLogsCsv() {
    let l = "time,retailer,mobile,farmer,farmerId,cscId,cost\n";
    Object.values(allLogs || {}).forEach((x) => {
      if (!x) return;
      l += [fmtDate(x.timestamp), x.userName, x.userMobile, x.name, x.farmerId, x.cscUserId, x.costCharged].map((v) => '"' + String(v ?? "").replace(/"/g, "'") + '"').join(",") + "\n";
    });
    exportCsv("logs.csv", l);
  }
  if ($("btnExportRet")) $("btnExportRet").onclick = downloadUsersCsv;
  if ($("btnExportLogs")) $("btnExportLogs").onclick = downloadLogsCsv;
  if ($("btnExportUsers2")) $("btnExportUsers2").onclick = downloadUsersCsv;
  if ($("btnBackup")) $("btnBackup").onclick = async () => {
    const data = { _exportedAt: Date.now() };
    for (const p of ["users", "token_requests", "distributors", "usage_logs", "password_requests", "settings", "portal_expenses", "admin_income"]) data[p] = await safeGet(p);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = "farmer-id-backup.json";
    a.click();
  };
  if ($("btnExportAll")) $("btnExportAll").onclick = () => { downloadUsersCsv(); downloadLogsCsv(); };
  if ($("btnRestore")) $("btnRestore").onclick = async () => {
    const f = $("restoreFile").files[0];
    if (!f) return alert("JSON file choose karein");
    if (!confirm("RESTORE will OVERWRITE selected nodes. Continue?")) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch (e) { return alert("Invalid JSON"); }
    if (!auth.currentUser) return alert("Admin login required");
    const keys = Object.keys(data).filter((k) => !k.startsWith("_") && data[k] !== undefined);
    let ok = 0, fail = 0;
    for (const k of keys) {
      try {
        // force overwrite: remove then set
        await db.ref(k).set(null);
        await db.ref(k).set(data[k]);
        ok++;
      } catch (e) {
        console.warn("restore fail", k, e);
        fail++;
      }
    }
    alert("Restore done. OK: " + ok + " · Fail: " + fail + (fail ? " (Rules/Auth check)" : ""));
    await loadAll();
  };

  function showStatement(id, u) {
    const h = Array.isArray(u.tokenHistory) ? u.tokenHistory.slice() : [];
    h.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    $("stmtBody").innerHTML = `<p><b>${esc(u.name)}</b> · ${esc(u.mobile)} · Tokens: ${u.tokens || 0}</p>
      <table style="width:100%"><thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Note</th></tr></thead>
      <tbody>${h.map((x) => `<tr><td>${fmtDate(x.timestamp)}</td><td>${esc(x.type)}</td><td>${x.amount}</td><td>${esc(x.reason || "")}</td></tr>`).join("") || "<tr><td colspan=4>Empty</td></tr>"}</tbody></table>`;
    $("modalStmt").classList.remove("hidden");
  }
  if ($("btnCloseStmt")) $("btnCloseStmt").onclick = () => $("modalStmt").classList.add("hidden");
  if ($("btnPrintStmt")) $("btnPrintStmt").onclick = () => { const w = window.open("", "_blank"); w.document.write($("stmtBody").innerHTML); w.print(); };
  if ($("btnCloseEdit")) $("btnCloseEdit").onclick = () => $("modalEdit").classList.add("hidden");
  if ($("btnSaveEdit")) $("btnSaveEdit").onclick = async () => {
    const id = $("edId").value;
    const rate = $("edRate").value.trim();
    await fbUpdate("users/" + id, {
      name: $("edName").value.trim(), mobile: $("edMobile").value.trim(), password: $("edPass").value,
      address: $("edAddr").value.trim(), tokenCost: rate === "" ? null : parseInt(rate, 10),
      distributorId: $("edDist").value.trim() || null, status: $("edStatus").value, walletRefillDisabled: $("edRefillOff").checked
    });
    $("modalEdit").classList.add("hidden");
    await loadAll();
  };
  if ($("btnCloseTokEdit")) $("btnCloseTokEdit").onclick = () => $("modalTokEdit").classList.add("hidden");
  if ($("btnSaveTokEdit")) $("btnSaveTokEdit").onclick = async () => {
    const id = $("teId").value;
    await fbUpdate("token_requests/" + id, {
      amount: parseInt($("teQty").value, 10) || 0,
      totalAmount: parseFloat($("teAmt").value) || 0,
      utr: $("teUtr").value.trim(),
      status: $("teStatus").value
    });
    $("modalTokEdit").classList.add("hidden");
    await loadAll();
  };

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-dd]");
    if (btn) {
      e.stopPropagation();
      const dd = btn.closest(".dd");
      document.querySelectorAll(".dd.open").forEach((x) => { if (x !== dd) x.classList.remove("open"); });
      if (dd) dd.classList.toggle("open");
      return;
    }
    if (!e.target.closest(".dd")) document.querySelectorAll(".dd.open").forEach((x) => x.classList.remove("open"));
  });

  try {
    initFirebase();
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        show($("loginPage"), false);
        show($("app"), true);
        setText("adminEmail", (user.email || "") + " · UID: " + (user.uid || ""));
        // Remind if not admin in rules
        try {
          const adm = await safeGet("adminUids/" + user.uid);
          if (adm !== true) {
            console.warn("Add adminUids/" + user.uid + " = true in Firebase Database for full admin access");
            setText("dbStatus", "Set adminUids/" + user.uid + " = true");
            const st = $("dbStatus"); if (st) st.className = "badge err";
          }
        } catch (e) {}
        await loadAll();
        try {
          db.ref("users").on("value", (s) => { allUsers = s.val() || {}; });
          db.ref("token_requests").on("value", (s) => { allTokenReqs = s.val() || {}; });
          db.ref("settings").on("value", (s) => { settings = s.val() || {}; });
        } catch (e) {}
      } else {
        show($("app"), false);
        show($("loginPage"), true);
      }
    });
  } catch (e) {
    const err = $("loginError");
    if (err) { err.textContent = e.message || String(e); show(err, true); }
  }
})();
