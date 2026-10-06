/* Farmer ID Pro Admin v5.1 */
(function () {
  "use strict";
  let auth, db;
  let allUsers = {}, allTokenReqs = {}, allDists = {}, allLogs = {}, allPass = {}, allExpenses = {}, settings = {};
  let incomeChart = null;

  const $ = (id) => document.getElementById(id);
  const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  const show = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
  async function safeGet(path) {
    try { return await fbGet(path); } catch (e) { console.warn("safeGet", path, e); return null; }
  }
  const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const fmtDate = (t) => (t ? new Date(t).toLocaleString("en-IN") : "—");
  const daysAgo = (t) => {
    if (!t) return 9999;
    return Math.floor((Date.now() - t) / 86400000);
  };

  function initFirebase() {
    if (!window.FIREBASE_CONFIG || window.FIREBASE_CONFIG.apiKey === "PASTE_API_KEY")
      throw new Error("firebase-config.js me API key set karein");
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.database();
  }

  async function fbGet(path) {
    const s = await db.ref(path).once("value");
    return s.val();
  }
  async function fbSet(path, data) {
    await db.ref(path).set(data);
    return true;
  }
  async function fbUpdate(path, data) {
    await db.ref(path).update(data);
    return true;
  }

  $("btnLogin").onclick = async () => {
    const err = $("loginError");
    show(err, false);
    const btn = $("btnLogin");
    btn.disabled = true; btn.textContent = "…";
    try {
      initFirebase();
      await auth.signInWithEmailAndPassword($("loginEmail").value.trim(), $("loginPass").value);
    } catch (e) {
      err.textContent = e.message || String(e);
      show(err, true);
    }
    btn.disabled = false; btn.textContent = "Login";
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
      refreshTab(btn.dataset.tab);
    };
  });
  $("btnRefresh").onclick = () => loadAll();

  function refreshTab(tab) {
    if (tab === "dashboard") renderDashboard();
    if (tab === "retailers") renderRetailers();
    if (tab === "pending") renderPending();
    if (tab === "tokens") renderTokens();
    if (tab === "distributors") renderDists();
    if (tab === "logs") renderLogs();
    if (tab === "passreq") renderPass();
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
      allExpenses = e || {};
      window._adminIncome = inc || {};
      setText("dbStatus", "DB Connected");
      $("dbStatus").className = "badge ok";
      const active = document.querySelector(".nav.active");
      refreshTab(active ? active.dataset.tab : "dashboard");
    } catch (e) {
      setText("dbStatus", "Error: " + (e.message || e));
      $("dbStatus").className = "badge err";
    }
  }

  function inactiveDays() {
    return Math.max(1, parseInt(settings.inactiveDays, 10) || 7);
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0,0,0,0);
    return d.getTime();
  }
  function incomeEntries() {
    const list = [];
    // From approved token requests
    Object.values(allTokenReqs || {}).forEach((r) => {
      if (!r || r.status !== "approved") return;
      const amt = Number(r.totalAmount) || 0;
      const ts = r.finalApprovedAt || r.approvedAt || r.createdAt || 0;
      if (amt) list.push({ amount: amt, ts, type: "sale" });
    });
    // Manual admin credits with rate
    Object.values(window._adminIncome || {}).forEach((x) => {
      if (!x) return;
      list.push({ amount: Number(x.amount) || 0, ts: x.timestamp || 0, type: x.type || "manual" });
    });
    return list;
  }
  function sumInRange(list, from, to) {
    return list.filter((x) => x.ts >= from && x.ts < to).reduce((s, x) => s + (x.amount || 0), 0);
  }
  function totalExpense() {
    return Object.values(allExpenses || {}).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  }

  function renderDashboard() {
    const users = Object.values(allUsers || {}).filter(Boolean);
    const reqs = Object.values(allTokenReqs || {}).filter(Boolean);
    const idays = inactiveDays();
    const inactive = users.filter((u) => u.status === "active" && daysAgo(u.lastSeenAt || u.lastUsed) >= idays);

    const now = Date.now();
    const day0 = startOfDay(now);
    const d = new Date();
    const month0 = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const year0 = new Date(d.getFullYear(), 0, 1).getTime();
    const inc = incomeEntries();
    const today = sumInRange(inc, day0, day0 + 86400000);
    const month = sumInRange(inc, month0, now + 1);
    const year = sumInRange(inc, year0, now + 1);
    // refunds are negative in admin_income type refund
    const exp = totalExpense();
    const gross = inc.reduce((s, x) => s + (x.amount || 0), 0);
    const profit = gross - exp;

    if ($("sToday")) $("sToday").textContent = "₹" + today;
    if ($("sMonth")) $("sMonth").textContent = "₹" + month;
    if ($("sYear")) $("sYear").textContent = "₹" + year;
    if ($("sExpense")) $("sExpense").textContent = "₹" + exp;
    if ($("sProfit")) $("sProfit").textContent = "₹" + profit;
    if ($("sTokPend")) $("sTokPend").textContent = reqs.filter((r) => (r.status || "pending") === "pending").length;

    const tp = reqs.filter((r) => (r.status || "pending") === "pending").length;
    const tt = reqs.filter((r) => r.status === "temp_approved").length;
    const up = users.filter((u) => u.status === "pending").length;
    if ($("pendingSummary")) {
      $("pendingSummary").innerHTML =
        `<p>Token pending: <b>${tp}</b> · Temp: <b>${tt}</b> · Users: <b>${up}</b></p>`;
    }

    // Top retailers by generates
    const top = users.slice().sort((a, b) => (b.totalUsed || 0) - (a.totalUsed || 0)).slice(0, 8);
    if ($("topRetailers")) {
      $("topRetailers").innerHTML = top.length
        ? "<ol style='margin-left:18px'>" + top.map((u) =>
            `<li><b>${esc(u.name)}</b> (${esc(u.mobile)}) — <b>${u.totalUsed || 0}</b> gen</li>`
          ).join("") + "</ol>"
        : "No data";
    }

    // Compact chart - last 6 months line
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
        data: {
          labels,
          datasets: [{
            label: "₹",
            data,
            borderColor: "#34d399",
            backgroundColor: "rgba(52,211,153,.15)",
            fill: true,
            tension: 0.3,
            pointRadius: 3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: "#94a3b8", maxRotation: 0, font: { size: 10 } }, grid: { display: false } },
            y: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "#334155" } }
          }
        }
      });
    }

    // Expenses table
    const et = $("expTable");
    if (et) {
      et.innerHTML = "";
      Object.entries(allExpenses || {})
        .sort((a, b) => (b[1].date || "").localeCompare(a[1].date || ""))
        .forEach(([id, x]) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${esc(x.date || "")}</td><td>${esc(x.title || "")}</td>
            <td>₹${x.amount || 0}</td>
            <td><button class="btn btn-sm btn-danger" data-eid="${esc(id)}">Del</button></td>`;
          et.appendChild(tr);
        });
      et.onclick = async (e) => {
        const b = e.target.closest("button[data-eid]");
        if (!b) return;
        if (!confirm("Delete expense?")) return;
        await fbSet("portal_expenses/" + b.dataset.eid, null);
        await loadAll();
      };
    }

    // Inactive table (existing)
    const tb = $("inactiveTable");
    if (!tb) return;
    tb.innerHTML = "";
    inactive.sort((a, b) => (a.lastSeenAt || 0) - (b.lastSeenAt || 0));
    inactive.slice(0, 50).forEach((u) => {
      const msg = !(u.lastSeenAt || u.lastUsed)
        ? "Never used"
        : "Inactive " + daysAgo(u.lastSeenAt || u.lastUsed) + "d";
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${esc(u.name)}</td><td>${esc(u.mobile)}</td>
        <td>${esc(u.lastVersion || "—")}</td><td>${fmtDate(u.lastSeenAt || u.lastUsed)}</td>
        <td>${u.totalUsed || 0}</td><td>${msg}</td>
        <td><a class="btn btn-sm" target="_blank" href="https://wa.me/91${String(u.mobile||"").replace(/\D/g,"").slice(-10)}?text=${encodeURIComponent("Namaste "+(u.name||"")+", Farmer ID extension use karein. Group: "+(settings.waGroupLink||""))}">WA</a></td>`;
      tb.appendChild(tr);
    });
    if (!inactive.length) tb.innerHTML = '<tr><td colspan="7" class="muted">No inactive</td></tr>';
  }

  $("btnMsgInactive") && ($("btnMsgInactive").onclick = () => {
    const idays = inactiveDays();
    const list = Object.values(allUsers || {}).filter(
      (u) => u && u.status === "active" && daysAgo(u.lastSeenAt || u.lastUsed) >= idays
    );
    const text = list.map((u) => (u.mobile || "") + " " + (u.name || "")).join("\n");
    const wa = (settings.whatsappNumber || "").replace(/\D/g, "");
    if (wa) window.open("https://wa.me/91" + wa + "?text=" + encodeURIComponent("Inactive retailers:\n" + text), "_blank");
    else alert(text || "None");
  });

  function distName(id) {
    if (!id || !allDists[id]) return "—";
    return allDists[id].name || allDists[id].mobile || id;
  }

  function renderRetailers() {
    const q = (($("retSearch") && $("retSearch").value) || "").toLowerCase();
    const st = ($("retStatus") && $("retStatus").value) || "";
    const tokF = ($("retTokFilter") && $("retTokFilter").value) || "";
    const sort = ($("retSort") && $("retSort").value) || "new";
    let list = Object.entries(allUsers || {}).filter(([, u]) => u && u.status !== "pending");
    if (st) list = list.filter(([, u]) => u.status === st);
    if (tokF === "zero") list = list.filter(([, u]) => !(u.tokens > 0));
    if (tokF === "has") list = list.filter(([, u]) => (u.tokens || 0) > 0);
    if (q) list = list.filter(([, u]) => (u.name || "").toLowerCase().includes(q) || String(u.mobile || "").includes(q) || (u.address || "").toLowerCase().includes(q));
    list.sort((a, b) => {
      const A = a[1], B = b[1];
      if (sort === "name") return (A.name || "").localeCompare(B.name || "");
      if (sort === "tokens") return (B.tokens || 0) - (A.tokens || 0);
      if (sort === "used") return (B.totalUsed || 0) - (A.totalUsed || 0);
      if (sort === "seen") return (B.lastSeenAt || 0) - (A.lastSeenAt || 0);
      if (sort === "old") return (A.createdAt || 0) - (B.createdAt || 0);
      return (B.createdAt || 0) - (A.createdAt || 0);
    });
    list = list.slice(0, 50);
    const tbody = $("retTable");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="muted">No data</td></tr>';
      return;
    }
    list.forEach(([uid, u]) => {
      const rate = u.tokenCost != null && u.tokenCost !== "" ? u.tokenCost : "def";
      const pill = u.status === "active" ? "pill-ok" : u.status === "blocked" ? "pill-bad" : "pill-pend";
      const tr = document.createElement("tr");
      if (!(u.tokens > 0)) tr.className = "row-zero";
      tr.innerHTML = `
        <td><b>${esc(u.name)}</b></td>
        <td>${esc(u.mobile)}</td>
        <td class="muted">${esc((u.address||"").slice(0,28))}</td>
        <td><b>${u.tokens || 0}</b></td>
        <td>${rate}</td>
        <td><span class="pill ${pill}">${esc(u.status)}</span></td>
        <td>${esc(distName(u.distributorId))}</td>
        <td class="muted">${fmtDate(u.lastSeenAt || u.lastUsed)}</td>
        <td>${u.totalUsed || 0}</td>
        <td>
          <div class="dd">
            <button type="button" class="dd-btn" data-dd="1">⋮</button>
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
            </div>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = async (e) => {
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
      } else if (a === "tok") {
        const n = prompt("Tokens CREDIT:", "10");
        if (n == null) return;
        const qty = parseInt(n, 10);
        if (!qty || qty < 1) return;
        const rate = prompt("Rate ₹ per token (income me add hoga):", "10");
        if (rate == null) return;
        const r = parseFloat(rate) || 0;
        const tokens = (u.tokens || 0) + qty;
        const h = Array.isArray(u.tokenHistory) ? u.tokenHistory.slice() : [];
        h.push({ type: "credit", amount: qty, reason: "Admin credit @₹" + r, rate: r, timestamp: Date.now(), balanceAfter: tokens });
        await fbUpdate("users/" + id, { tokens, tokenHistory: h });
        if (r > 0) {
          await fbSet("admin_income/inc_" + Date.now(), {
            amount: qty * r, type: "manual_credit", userId: id, qty, rate: r, timestamp: Date.now()
          });
        }
      } else if (a === "deb") {
        const n = prompt("Tokens DEBIT:", "1");
        if (n == null) return;
        const qty = parseInt(n, 10);
        if (!qty || qty < 1) return;
        if ((u.tokens || 0) < qty) return alert("Retailer ke paas itne tokens nahi");
        const refund = prompt("Refund ₹ (income se debit, 0 = nahi):", "0");
        if (refund == null) return;
        const rf = parseFloat(refund) || 0;
        const tokens = (u.tokens || 0) - qty;
        const h = Array.isArray(u.tokenHistory) ? u.tokenHistory.slice() : [];
        h.push({ type: "debit", amount: qty, reason: "Admin debit refund ₹" + rf, timestamp: Date.now(), balanceAfter: tokens });
        await fbUpdate("users/" + id, { tokens, tokenHistory: h });
        if (rf > 0) {
          await fbSet("admin_income/inc_" + Date.now(), {
            amount: -rf, type: "refund", userId: id, qty, timestamp: Date.now()
          });
        }
      } else if (a === "pass") {
        alert("Password: " + (u.password || "(not set)"));
        return;
      } else if (a === "wa") {
        const mob = String(u.mobile || "").replace(/\D/g, "").slice(-10);
        const msg = "Namaste " + (u.name || "") + " ji\nAapka Farmer ID login:\nMobile: " + (u.mobile || "") + "\nPassword: " + (u.password || "") + "\nGroup: " + (settings.waGroupLink || "");
        if (mob) window.open("https://wa.me/91" + mob + "?text=" + encodeURIComponent(msg), "_blank");
        return;
      } else if (a === "stmt") {
        showStatement(id, u);
        return;
      } else if (a === "rate") {
        const n = prompt("Token cost per ID (blank = default):", u.tokenCost != null ? u.tokenCost : "");
        if (n == null) return;
        const val = String(n).trim() === "" ? null : parseInt(n, 10);
        await fbUpdate("users/" + id, { tokenCost: val });
      } else if (a === "refill") {
        await fbUpdate("users/" + id, { walletRefillDisabled: !u.walletRefillDisabled });
      } else if (a === "block") {
        await fbUpdate("users/" + id, { status: u.status === "blocked" ? "active" : "blocked" });
      }
      await loadAll();
    };
  }

  ["retSearch", "retStatus", "retTokFilter", "retSort"].forEach((id) => {
    if ($(id)) $(id).oninput = $(id).onchange = () => renderRetailers();
  });

  function renderPending() {
    const tbody = $("pendTable");
    tbody.innerHTML = "";
    const list = Object.entries(allUsers || {})
      .filter(([, u]) => u && u.status === "pending")
      .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">None</td></tr>';
      return;
    }
    list.forEach(([uid, u]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${esc(u.name)}</td><td>${esc(u.mobile)}</td>
        <td class="muted">${esc((u.address||"").slice(0,40))}</td><td>${fmtDate(u.createdAt)}</td>
        <td>
          <button class="btn btn-sm btn-primary" data-a="ok" data-id="${esc(uid)}">Final Approve + WA</button>
          <button class="btn btn-sm btn-danger" data-a="del" data-id="${esc(uid)}">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.a === "ok") {
        const free = parseInt(prompt("Free tokens?", "2") || "2", 10) || 0;
        const u = allUsers[id];
        await fbUpdate("users/" + id, {
          status: "active", tokens: free, freeTokens: free,
          approvedAt: Date.now(), awaitingFinalApprove: false, finalApprovedAt: Date.now()
        });
        const group = settings.waGroupLink || "https://chat.whatsapp.com/JQPabDWptab6SKmIUscfj5";
        const video = settings.videoGuideLink || "";
        const tmpl = settings.approveMessage || `Namaste {name} ji
Aapka Farmer ID Generator account ready hai
Login Mobile: {mobile}
Password: {password}
Tokens: {tokens}
Install Guide Group:
{group}
Usage Guide Video:
{video}

Dhanyavad!`;
        const msg = tmpl
          .replace(/\{name\}/g, u.name || "")
          .replace(/\{mobile\}/g, u.mobile || "")
          .replace(/\{password\}/g, u.password || "")
          .replace(/\{tokens\}/g, String(free))
          .replace(/\{group\}/g, group)
          .replace(/\{video\}/g, video);
        const mob = String(u.mobile || "").replace(/\D/g, "").slice(-10);
        if (mob) window.open("https://wa.me/91" + mob + "?text=" + encodeURIComponent(msg), "_blank");
      } else {
        if (confirm("Delete?")) await fbSet("users/" + id, null);
      }
      await loadAll();
    };
  }

  async function creditUser(userId, qty, reason, rid) {
    const user = allUsers[userId];
    if (!user) throw new Error("User missing");
    const tokens = (user.tokens || 0) + qty;
    const history = Array.isArray(user.tokenHistory) ? user.tokenHistory.slice() : [];
    history.push({ type: qty >= 0 ? "credit" : "debit", amount: Math.abs(qty), reason, requestId: rid, timestamp: Date.now(), balanceAfter: tokens });
    await fbUpdate("users/" + userId, { tokens, tokenHistory: history });
  }

  function renderTokens() {
    const filt = ($("tokFilter") && $("tokFilter").value) || "";
    let list = Object.entries(allTokenReqs || {});
    if (filt) list = list.filter(([, r]) => (r.status || "pending") === filt);
    list.sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    const tbody = $("tokTable");
    tbody.innerHTML = "";
    list.slice(0, 50).forEach(([rid, r]) => {
      if (!r) return;
      const st = r.status || "pending";
      const pill = st === "approved" ? "pill-ok" : st === "temp_approved" ? "pill-temp" : st === "rejected" ? "pill-bad" : "pill-pend";
      let actions = "";
      if (st === "pending") {
        actions = `<button class="btn btn-sm btn-warn" data-a="temp" data-id="${esc(rid)}">Temp</button>
          <button class="btn btn-sm btn-primary" data-a="final" data-id="${esc(rid)}">Final</button>
          <button class="btn btn-sm btn-danger" data-a="rej" data-id="${esc(rid)}">Reject</button>`;
      } else if (st === "temp_approved") {
        actions = `<button class="btn btn-sm btn-primary" data-a="final" data-id="${esc(rid)}">Final</button>
          <button class="btn btn-sm btn-danger" data-a="rej" data-id="${esc(rid)}">Reject</button>`;
      } else {
        actions = `<button class="btn btn-sm btn-danger" data-a="del" data-id="${esc(rid)}">Del</button>`;
      }
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="muted">${fmtDate(r.createdAt)}</td><td>${esc(r.userName)}</td><td>${esc(r.userMobile)}</td>
        <td><b>${r.amount||0}</b></td><td>₹${r.totalAmount||0}</td><td><code>${esc(r.utr||"—")}</code></td>
        <td><span class="pill ${pill}">${esc(st)}</span></td><td>${actions}</td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = async (e) => {
      const b = e.target.closest("button[data-a]");
      if (!b) return;
      const rid = b.dataset.id;
      const r = allTokenReqs[rid];
      if (!r) return;
      const a = b.dataset.a;
      if (a === "temp") {
        if ((r.status || "pending") !== "pending") return;
        await creditUser(r.userId, parseInt(r.amount, 10) || 0, "Temp approve", rid);
        await fbUpdate("token_requests/" + rid, { status: "temp_approved", tempApprovedAt: Date.now() });
      } else if (a === "final") {
        if ((r.status || "pending") === "pending") {
          await creditUser(r.userId, parseInt(r.amount, 10) || 0, "Final approve", rid);
        }
        await fbUpdate("token_requests/" + rid, { status: "approved", finalApprovedAt: Date.now(), approvedAt: Date.now() });
      } else if (a === "rej") {
        if (r.status === "temp_approved" || r.status === "approved") {
          await creditUser(r.userId, -(parseInt(r.amount, 10) || 0), "Reject clawback", rid);
        }
        await fbUpdate("token_requests/" + rid, { status: "rejected", rejectedAt: Date.now() });
      } else if (a === "del") {
        if (r.status === "temp_approved" || r.status === "approved") {
          await creditUser(r.userId, -(parseInt(r.amount, 10) || 0), "Delete clawback", rid);
        }
        await fbSet("token_requests/" + rid, null);
      }
      await loadAll();
    };
  }
  if ($("tokFilter")) $("tokFilter").onchange = () => renderTokens();

  function renderDists() {
    const tbody = $("distTable");
    tbody.innerHTML = "";
    Object.entries(allDists || {}).forEach(([did, d]) => {
      if (!d) return;
      const count = Object.values(allUsers || {}).filter((u) => u && u.distributorId === did).length;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${esc(d.name)}</td><td>${esc(d.mobile)}</td><td><b>${d.tokens||0}</b></td>
        <td>${d.totalCommission||0}</td><td>${count}</td>
        <td>${esc(d.status||"active")}</td>
        <td>
          <button class="btn btn-sm" data-a="tok" data-id="${esc(did)}">+Tok</button>
          <button class="btn btn-sm btn-danger" data-a="block" data-id="${esc(did)}">${d.status==="blocked"?"Unblock":"Block"}</button>
 </td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const id = b.dataset.id;
      const d = allDists[id];
      if (b.dataset.a === "tok") {
        const n = parseInt(prompt("Add tokens", "10") || "0", 10);
        if (!n) return;
        await fbUpdate("distributors/" + id, { tokens: (d.tokens || 0) + n });
      } else {
        await fbUpdate("distributors/" + id, { status: d.status === "blocked" ? "active" : "blocked" });
      }
      await loadAll();
    };
  }

  $("btnAddDist").onclick = async () => {
    const name = $("dName").value.trim();
    const mobile = $("dMobile").value.replace(/\D/g, "").slice(0, 10);
    const password = $("dPass").value;
    if (!name || mobile.length < 10 || !password) return alert("Name, 10-digit mobile, password zaroori");
    const id = "d_" + mobile;
    if (allDists[id]) return alert("Already exists");
    await fbSet("distributors/" + id, {
      name, mobile, password, tokens: 0, totalCommission: 0,
      status: "active", createdAt: Date.now(), tokenHistory: []
    });
    alert("Distributor created. Login: distributor.html");
    $("dName").value = $("dMobile").value = $("dPass").value = "";
    await loadAll();
  };

  function renderLogs() {
    const q = (($("logSearch") && $("logSearch").value) || "").toLowerCase();
    const sort = ($("logSort") && $("logSort").value) || "new";
    let list = Object.entries(allLogs || {}).map(([k, v]) => ({ id: k, ...v })).filter((x) => x.timestamp);
    if (q) {
      list = list.filter((x) =>
        (x.userName || "").toLowerCase().includes(q) ||
        String(x.userMobile || "").includes(q) ||
        (x.name || "").toLowerCase().includes(q) ||
        String(x.farmerId || "").includes(q)
      );
    }
    list.sort((a, b) => sort === "old" ? (a.timestamp || 0) - (b.timestamp || 0) : (b.timestamp || 0) - (a.timestamp || 0));
    const tbody = $("logTable");
    tbody.innerHTML = "";
    list.slice(0, 50).forEach((x) => {
      const place = [x.taluka, x.district, x.state].filter(Boolean).join(", ");
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="muted">${fmtDate(x.timestamp)}</td>
        <td>${esc(x.userName)} <span class="muted">${esc(x.userMobile)}</span></td>
        <td>${esc(x.name)} <code>${esc(x.farmerId||"")}</code></td>
        <td><code>${esc(x.cscUserId||"—")}</code></td>
        <td class="muted">${esc(place)}</td><td>${x.tokensLeft??"—"}</td><td>${x.costCharged??"—"}</td>`;
      tbody.appendChild(tr);
    });
    if (!list.length) tbody.innerHTML = '<tr><td colspan="7" class="muted">No logs</td></tr>';
  }
  if ($("logSearch")) $("logSearch").oninput = () => renderLogs();
  if ($("logSort")) $("logSort").onchange = () => renderLogs();

  function renderPass() {
    const tbody = $("passTable");
    tbody.innerHTML = "";
    Object.entries(allPass || {}).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0)).slice(0, 50).forEach(([id, r]) => {
      if (!r) return;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${fmtDate(r.createdAt)}</td><td>${esc(r.mobile)}</td><td>${esc(r.name||"")}</td>
        <td>${esc(r.status||"pending")}</td>
        <td><button class="btn btn-sm btn-danger" data-id="${esc(id)}">Delete</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      await fbSet("password_requests/" + b.dataset.id, null);
      await loadAll();
    };
  }

  function fillDistSelects() {
    const opts = '<option value="">— None —</option>' +
      Object.entries(allDists || {}).map(([id, d]) =>
        `<option value="${esc(id)}">${esc(d.name)} (${esc(d.mobile)})</option>`
      ).join("");
    if ($("arDist")) $("arDist").innerHTML = opts;
    if ($("mapDist")) $("mapDist").innerHTML = opts;
  }

  $("btnAddRet").onclick = async () => {
    const name = $("arName").value.trim();
    const mobile = $("arMobile").value.replace(/\D/g, "").slice(0, 10);
    const password = $("arPass").value || "123456";
    if (!name || mobile.length < 10) return alert("Name + mobile");
    const uid = "u_" + mobile;
    if (allUsers[uid]) return alert("Already exists");
    const rate = $("arRate").value.trim();
    await fbSet("users/" + uid, {
      name, mobile, password,
      address: $("arAddr").value.trim(),
      tokens: parseInt($("arTokens").value, 10) || 0,
      freeTokens: 0,
      status: "active",
      createdAt: Date.now(),
      approvedAt: Date.now(),
      distributorId: $("arDist").value || null,
      tokenCost: rate === "" ? null : parseInt(rate, 10),
      walletRefillDisabled: false,
      tokenHistory: [],
      generatedFarmerIds: {},
      totalUsed: 0
    });
    alert("Retailer created");
    await loadAll();
  };

  $("btnMap").onclick = async () => {
    const mobile = $("mapRetMobile").value.replace(/\D/g, "").slice(0, 10);
    const uid = "u_" + mobile;
    if (!allUsers[uid]) return alert("Retailer not found");
    await fbUpdate("users/" + uid, { distributorId: $("mapDist").value || null });
    alert("Mapped");
    await loadAll();
  };

  function fillSettings() {
    const s = settings || {};
    $("setAutoPay").value = s.autoApproveEnabled ? "1" : "0";
    $("setAutoRet").value = s.autoTempApproveRetailer ? "1" : "0";
    $("setTokenCost").value = s.tokenCost != null ? s.tokenCost : 1;
    $("setFreeGen").value = s.freeGenerateEnabled ? "1" : "0";
    $("setInactiveDays").value = s.inactiveDays || 7;
    $("setDistEvery").value = s.distCommissionEvery || 2;
    $("setDistGive").value = s.distCommissionGive != null ? s.distCommissionGive : 1;
    $("setWa").value = s.whatsappNumber || "";
    $("setWaGroup").value = s.waGroupLink || "";
    $("setBuyMsg").value = s.buyMessage || "";
    $("setApproveMsg").value = s.approveMessage || `Namaste {name} ji
Aapka Farmer ID Generator account ready hai
Login Mobile: {mobile}
Password: {password}
Tokens: {tokens}
Install Guide Group:
{group}
Usage Guide Video:
{video}

Dhanyavad!`;
    if ($("setVideo")) $("setVideo").value = s.videoGuideLink || "";
    $("setUpi").value = s.upiLink || "";
    $("rate1").value = s.rate1to5 != null ? s.rate1to5 : 20;
    $("rate2").value = s.rate6to10 != null ? s.rate6to10 : 15;
    $("rate3").value = s.rate11plus != null ? s.rate11plus : 10;
    $("rzpEn").value = s.razorpayEnabled ? "1" : "0";
    $("rzpKey").value = s.razorpayKeyId || "";
    $("setMoreEn").value = s.moreServiceEnabled ? "1" : "0";
    $("setMoreUrl").value = s.moreServiceUrl || "";
  }

  $("btnSaveAuto").onclick = async () => {
    await fbUpdate("settings", {
      autoApproveEnabled: $("setAutoPay").value === "1",
      autoTempApproveRetailer: $("setAutoRet").value === "1",
      tokenCost: parseInt($("setTokenCost").value, 10) || 0,
      freeGenerateEnabled: $("setFreeGen").value === "1",
      inactiveDays: parseInt($("setInactiveDays").value, 10) || 7
    });
    alert("Saved"); await loadAll();
  };
  $("btnSaveDistComm").onclick = async () => {
    await fbUpdate("settings", {
      distCommissionEvery: parseInt($("setDistEvery").value, 10) || 2,
      distCommissionGive: parseInt($("setDistGive").value, 10) || 0
    });
    alert("Commission saved"); await loadAll();
  };
  $("btnSaveSupport").onclick = async () => {
    await fbUpdate("settings", {
      whatsappNumber: $("setWa").value.trim(),
      waGroupLink: $("setWaGroup").value.trim(),
      buyMessage: $("setBuyMsg").value.trim(),
      approveMessage: $("setApproveMsg").value.trim(),
      videoGuideLink: ($("setVideo") && $("setVideo").value.trim()) || "",
      upiLink: $("setUpi").value.trim()
    });
    alert("Support saved"); await loadAll();
  };
  $("btnSaveRates").onclick = async () => {
    await fbUpdate("settings", {
      rate1to5: parseFloat($("rate1").value) || 20,
      rate6to10: parseFloat($("rate2").value) || 15,
      rate11plus: parseFloat($("rate3").value) || 10,
      razorpayEnabled: $("rzpEn").value === "1",
      razorpayKeyId: $("rzpKey").value.trim(),
      moreServiceEnabled: $("setMoreEn").value === "1",
      moreServiceUrl: $("setMoreUrl").value.trim()
    });
    alert("Saved"); await loadAll();
  };

  // Backup / Restore
  $("btnBackup").onclick = async () => {
    const paths = ["users", "token_requests", "distributors", "usage_logs", "password_requests", "settings", "admins", "services", "service_categories", "service_requests", "portal_expenses"];
    const data = { _exportedAt: Date.now(), _version: 5 };
    for (const p of paths) {
      try { data[p] = await fbGet(p); } catch (e) { data[p] = null; }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "farmer-id-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
  };
  $("btnRestore").onclick = async () => {
    const f = $("restoreFile").files[0];
    if (!f) return alert("File choose karein");
    if (!confirm("RESTORE will OVERWRITE database nodes. Continue?")) return;
    const text = await f.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { return alert("Invalid JSON"); }
    const keys = ["users", "token_requests", "distributors", "usage_logs", "password_requests", "settings", "admins", "services", "service_categories", "service_requests", "portal_expenses"];
    for (const k of keys) {
      if (data[k] !== undefined) await fbSet(k, data[k]);
    }
    alert("Restore done");
    await loadAll();
  };



  function showStatement(id, u) {
    const h = Array.isArray(u.tokenHistory) ? u.tokenHistory.slice() : [];
    h.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    let rows = h.map((x) =>
      `<tr><td>${fmtDate(x.timestamp)}</td><td>${esc(x.type)}</td><td>${x.amount}</td><td>${esc(x.reason||"")}</td><td>${x.balanceAfter??""}</td></tr>`
    ).join("");
    if (!rows) rows = '<tr><td colspan="5">No transactions</td></tr>';
    $("stmtBody").innerHTML = `
      <p><b>${esc(u.name)}</b> · ${esc(u.mobile)} · Tokens: <b>${u.tokens||0}</b> · Used: ${u.totalUsed||0}</p>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Note</th><th>Bal</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    $("modalStmt").classList.remove("hidden");
  }
  if ($("btnCloseStmt")) $("btnCloseStmt").onclick = () => $("modalStmt").classList.add("hidden");
  if ($("btnPrintStmt")) $("btnPrintStmt").onclick = () => {
    const w = window.open("", "_blank");
    w.document.write("<html><head><title>Statement</title></head><body>" + $("stmtBody").innerHTML + "</body></html>");
    w.document.close();
    w.print();
  };
  if ($("btnCloseEdit")) $("btnCloseEdit").onclick = () => $("modalEdit").classList.add("hidden");
  if ($("btnSaveEdit")) $("btnSaveEdit").onclick = async () => {
    const id = $("edId").value;
    const rate = $("edRate").value.trim();
    await fbUpdate("users/" + id, {
      name: $("edName").value.trim(),
      mobile: $("edMobile").value.trim(),
      password: $("edPass").value,
      address: $("edAddr").value.trim(),
      tokenCost: rate === "" ? null : parseInt(rate, 10),
      distributorId: $("edDist").value.trim() || null,
      status: $("edStatus").value,
      walletRefillDisabled: $("edRefillOff").checked
    });
    $("modalEdit").classList.add("hidden");
    await loadAll();
  };

  if ($("btnAddExp")) $("btnAddExp").onclick = async () => {
    const title = $("expTitle").value.trim();
    const amount = parseFloat($("expAmount").value) || 0;
    let date = $("expDate").value;
    if (!date) date = new Date().toISOString().slice(0, 10);
    if (!title || !amount) return alert("Title + amount");
    const id = "exp_" + Date.now();
    await fbSet("portal_expenses/" + id, { title, amount, date, createdAt: Date.now() });
    $("expTitle").value = "";
    $("expAmount").value = "";
    await loadAll();
  };

  async function exportCsv(name, rows) {
    const blob = new Blob([rows], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  }
  if ($("btnExportAll")) $("btnExportAll").onclick = async () => {
    // users
    let u = "id,name,mobile,password,tokens,status,rate,distributor,totalUsed,lastSeen\n";
    Object.entries(allUsers || {}).forEach(([id, x]) => {
      if (!x) return;
      u += [id, x.name, x.mobile, x.password, x.tokens, x.status, x.tokenCost, x.distributorId, x.totalUsed, x.lastSeenAt].map((v) => `"${String(v??"").replace(/"/g,"'")}"`).join(",") + "\n";
    });
    await exportCsv("users.csv", u);
    let l = "time,retailer,mobile,farmer,farmerId,cscId,place,tokensLeft,cost\n";
    Object.values(allLogs || {}).forEach((x) => {
      if (!x) return;
      const place = [x.taluka, x.district, x.state].filter(Boolean).join(" ");
      l += [fmtDate(x.timestamp), x.userName, x.userMobile, x.name, x.farmerId, x.cscUserId, place, x.tokensLeft, x.costCharged].map((v) => `"${String(v??"").replace(/"/g,"'")}"`).join(",") + "\n";
    });
    await exportCsv("logs.csv", l);
    let r = "date,name,mobile,qty,amount,utr,status\n";
    Object.values(allTokenReqs || {}).forEach((x) => {
      if (!x) return;
      r += [fmtDate(x.createdAt), x.userName, x.userMobile, x.amount, x.totalAmount, x.utr, x.status].map((v) => `"${String(v??"").replace(/"/g,"'")}"`).join(",") + "\n";
    });
    await exportCsv("token_requests.csv", r);
    alert("CSV files downloaded (users, logs, token_requests). JSON backup bhi le sakte ho.");
  };

  // admin_income live
  // (loaded in loadAll)


  function startLive() {
    db.ref("users").on("value", (s) => { allUsers = s.val() || {}; refreshTab(document.querySelector(".nav.active")?.dataset.tab || "dashboard"); });
    db.ref("token_requests").on("value", (s) => { allTokenReqs = s.val() || {}; });
    db.ref("distributors").on("value", (s) => { allDists = s.val() || {}; });
    db.ref("usage_logs").on("value", (s) => { allLogs = s.val() || {}; });
    db.ref("settings").on("value", (s) => { settings = s.val() || {}; });
  }


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
  if ($("btnMenu")) $("btnMenu").onclick = () => { const app = $("app") || document.getElementById("app"); if (app) app.classList.toggle("sidebar-open"); };
  function downloadUsersCsv() {
    let u = "id,name,mobile,password,tokens,status,rate,address,distributor,totalUsed,lastSeen\n";
    Object.entries(allUsers || {}).forEach(([id, x]) => {
      if (!x) return;
      u += [id, x.name, x.mobile, x.password, x.tokens, x.status, x.tokenCost, x.address, x.distributorId, x.totalUsed, x.lastSeenAt].map((v) => '"' + String(v ?? "").replace(/"/g, "'") + '"').join(",") + "\n";
    });
    if (typeof exportCsv === "function") exportCsv("users.csv", u);
    else {
      const blob = new Blob([u], { type: "text/csv" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "users.csv"; a.click();
    }
  }
  function downloadLogsCsv() {
    let l = "time,retailer,mobile,farmer,farmerId,cscId,place,tokensLeft,cost\n";
    Object.values(allLogs || {}).forEach((x) => {
      if (!x) return;
      const place = [x.taluka, x.district, x.state].filter(Boolean).join(" ");
      l += [fmtDate(x.timestamp), x.userName, x.userMobile, x.name, x.farmerId, x.cscUserId, place, x.tokensLeft, x.costCharged].map((v) => '"' + String(v ?? "").replace(/"/g, "'") + '"').join(",") + "\n";
    });
    if (typeof exportCsv === "function") exportCsv("logs.csv", l);
    else {
      const blob = new Blob([l], { type: "text/csv" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "logs.csv"; a.click();
    }
  }
  if ($("btnExportRet")) $("btnExportRet").onclick = downloadUsersCsv;
  if ($("btnExportLogs")) $("btnExportLogs").onclick = downloadLogsCsv;
  if ($("btnExportUsers2")) $("btnExportUsers2").onclick = downloadUsersCsv;

  try {
    initFirebase();
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        show($("loginPage"), false);
        show($("app"), true);
        setText("adminEmail", user.email || user.uid);
        await loadAll();
        startLive();
      } else {
        show($("app"), false);
        show($("loginPage"), true);
      }
    });
  } catch (e) {
    const err = $("loginError");
    err.textContent = e.message || String(e);
    show(err, true);
  }
})();
