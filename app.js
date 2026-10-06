/* Farmer ID Pro Admin v5.1 */
(function () {
  "use strict";
  let auth, db;
  let allUsers = {}, allTokenReqs = {}, allDists = {}, allLogs = {}, allPass = {}, settings = {};
  let incomeChart = null;

  const $ = (id) => document.getElementById(id);
  const show = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
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
      $("pageTitle").textContent = btn.textContent.replace(/^[^\s]+\s/, "");
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
      const [u, t, d, l, p, s] = await Promise.all([
        fbGet("users"), fbGet("token_requests"), fbGet("distributors"),
        fbGet("usage_logs"), fbGet("password_requests"), fbGet("settings")
      ]);
      allUsers = u || {}; allTokenReqs = t || {}; allDists = d || {};
      allLogs = l || {}; allPass = p || {}; settings = s || {};
      $("dbStatus").textContent = "DB Connected";
      $("dbStatus").className = "badge ok";
      const active = document.querySelector(".nav.active");
      refreshTab(active ? active.dataset.tab : "dashboard");
    } catch (e) {
      $("dbStatus").textContent = "Error: " + (e.message || e);
      $("dbStatus").className = "badge err";
    }
  }

  function inactiveDays() {
    return Math.max(1, parseInt(settings.inactiveDays, 10) || 7);
  }

  function renderDashboard() {
    const users = Object.values(allUsers || {}).filter(Boolean);
    const reqs = Object.values(allTokenReqs || {}).filter(Boolean);
    const idays = inactiveDays();
    const inactive = users.filter((u) => u.status === "active" && daysAgo(u.lastSeenAt || u.lastUsed) >= idays);
    $("sRetailers").textContent = users.filter((u) => u.status !== "pending").length;
    $("sActive").textContent = users.filter((u) => u.status === "active").length;
    $("sInactive").textContent = inactive.length;
    $("sPending").textContent = users.filter((u) => u.status === "pending").length;
    $("sTokPend").textContent = reqs.filter((r) => (r.status || "pending") === "pending").length;
    let sale = 0;
    reqs.forEach((r) => { if (r.status === "approved") sale += Number(r.totalAmount) || 0; });
    $("sSale").textContent = "₹" + sale;

    // Pending summary
    const tp = reqs.filter((r) => (r.status || "pending") === "pending").length;
    const tt = reqs.filter((r) => r.status === "temp_approved").length;
    const up = users.filter((u) => u.status === "pending").length;
    $("pendingSummary").innerHTML =
      `<p>Token pending: <b>${tp}</b></p><p>Temp approved: <b>${tt}</b></p><p>User pending: <b>${up}</b></p>`;

    // Usage 7d
    const logs = Object.values(allLogs || {}).filter(Boolean);
    const week = Date.now() - 7 * 86400000;
    const recent = logs.filter((x) => (x.timestamp || 0) >= week);
    $("usageReport").innerHTML =
      `<p>Last 7 days generates: <b>${recent.length}</b></p><p>All-time logs: <b>${logs.length}</b></p>`;

    // Monthly income chart
    const months = {};
    reqs.forEach((r) => {
      if (r.status !== "approved" || !r.approvedAt && !r.finalApprovedAt && !r.createdAt) return;
      const ts = r.finalApprovedAt || r.approvedAt || r.createdAt;
      const d = new Date(ts);
      const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      months[key] = (months[key] || 0) + (Number(r.totalAmount) || 0);
    });
    const labels = Object.keys(months).sort().slice(-12);
    const data = labels.map((k) => months[k]);
    const ctx = $("chartIncome");
    if (ctx && typeof Chart !== "undefined") {
      if (incomeChart) incomeChart.destroy();
      incomeChart = new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [{ label: "₹ Approved", data, backgroundColor: "#10b981" }]
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
            y: { ticks: { color: "#94a3b8" }, grid: { color: "#334155" } }
          }
        }
      });
    }

    // Inactive table
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
    const sort = ($("retSort") && $("retSort").value) || "new";
    let list = Object.entries(allUsers || {}).filter(([, u]) => u && u.status !== "pending");
    if (st) list = list.filter(([, u]) => u.status === st);
    if (q) list = list.filter(([, u]) => (u.name || "").toLowerCase().includes(q) || String(u.mobile || "").includes(q));
    list.sort((a, b) => {
      const A = a[1], B = b[1];
      if (sort === "name") return (A.name || "").localeCompare(B.name || "");
      if (sort === "tokens") return (B.tokens || 0) - (A.tokens || 0);
      if (sort === "used") return (B.totalUsed || 0) - (A.totalUsed || 0);
      if (sort === "seen") return (B.lastSeenAt || 0) - (A.lastSeenAt || 0);
      if (sort === "old") return (A.createdAt || 0) - (B.createdAt || 0);
      return (B.createdAt || 0) - (A.createdAt || 0);
    });
    const tbody = $("retTable");
    tbody.innerHTML = "";
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="muted">No data</td></tr>';
      return;
    }
    list.forEach(([uid, u]) => {
      const rate = u.tokenCost != null && u.tokenCost !== "" ? u.tokenCost : "def";
      const pill = u.status === "active" ? "pill-ok" : u.status === "blocked" ? "pill-bad" : "pill-pend";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><b>${esc(u.name)}</b></td>
        <td>${esc(u.mobile)}</td>
        <td><b>${u.tokens || 0}</b></td>
        <td>${rate}</td>
        <td><span class="pill ${pill}">${esc(u.status)}</span></td>
        <td>${esc(distName(u.distributorId))}</td>
        <td>${esc(u.lastVersion || "—")}</td>
        <td class="muted">${fmtDate(u.lastSeenAt || u.lastUsed)}</td>
        <td>${u.totalUsed || 0}</td>
        <td>${u.walletRefillDisabled ? "OFF" : "ON"}</td>
        <td>
          <button class="btn btn-sm" data-a="tok" data-id="${esc(uid)}">+Tok</button>
          <button class="btn btn-sm" data-a="rate" data-id="${esc(uid)}">Rate</button>
          <button class="btn btn-sm" data-a="map" data-id="${esc(uid)}">Dist</button>
          <button class="btn btn-sm" data-a="refill" data-id="${esc(uid)}">${u.walletRefillDisabled ? "Refill ON" : "Refill OFF"}</button>
          <button class="btn btn-sm" data-a="hist" data-id="${esc(uid)}">History</button>
          <button class="btn btn-sm btn-danger" data-a="block" data-id="${esc(uid)}">${u.status === "blocked" ? "Unblock" : "Block"}</button>
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
      if (a === "tok") {
        const n = prompt("Tokens add:", "10");
        if (n == null) return;
        const qty = parseInt(n, 10);
        if (!qty) return;
        const tokens = (u.tokens || 0) + qty;
        const h = Array.isArray(u.tokenHistory) ? u.tokenHistory.slice() : [];
        h.push({ type: "credit", amount: qty, reason: "Admin", timestamp: Date.now(), balanceAfter: tokens });
        await fbUpdate("users/" + id, { tokens, tokenHistory: h });
      } else if (a === "rate") {
        const n = prompt("Token cost per ID (blank = default global):", u.tokenCost != null ? u.tokenCost : "");
        if (n == null) return;
        const val = n.trim() === "" ? null : parseInt(n, 10);
        await fbUpdate("users/" + id, { tokenCost: val });
      } else if (a === "map") {
        const opts = Object.entries(allDists || {}).map(([did, d]) => did + " = " + (d.name || d.mobile)).join("\n");
        const did = prompt("Distributor id (d_xxxxxxxxxx):\n" + opts, u.distributorId || "");
        if (did == null) return;
        await fbUpdate("users/" + id, { distributorId: did.trim() || null });
      } else if (a === "refill") {
        await fbUpdate("users/" + id, { walletRefillDisabled: !u.walletRefillDisabled });
      } else if (a === "hist") {
        const h = Array.isArray(u.tokenHistory) ? u.tokenHistory : [];
        alert(h.slice(-20).map((x) => `${x.type} ${x.amount} — ${x.reason || ""} @ ${fmtDate(x.timestamp)}`).join("\n") || "No history");
        return;
      } else if (a === "block") {
        await fbUpdate("users/" + id, { status: u.status === "blocked" ? "active" : "blocked" });
      }
      await loadAll();
    };
  }

  ["retSearch", "retStatus", "retSort"].forEach((id) => {
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
        const free = parseInt(prompt("Free tokens?", "0") || "0", 10) || 0;
        await fbUpdate("users/" + id, {
          status: "active", tokens: free, freeTokens: free,
          approvedAt: Date.now(), awaitingFinalApprove: false, finalApprovedAt: Date.now()
        });
        const u = allUsers[id];
        const group = settings.waGroupLink || "";
        const tmpl = settings.approveMessage ||
          "Namaste {name}! Aapka Farmer ID account APPROVE ho gaya. Group join karein: {group}";
        const msg = tmpl.replace("{name}", u.name || "").replace("{group}", group);
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
    list.slice(0, 100).forEach(([rid, r]) => {
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
    list.slice(0, 150).forEach((x) => {
      const place = [x.taluka, x.district, x.state].filter(Boolean).join(", ");
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="muted">${fmtDate(x.timestamp)}</td>
        <td>${esc(x.userName)} <span class="muted">${esc(x.userMobile)}</span></td>
        <td>${esc(x.name)} <code>${esc(x.farmerId||"")}</code></td>
        <td class="muted">${esc(place)}</td><td>${x.tokensLeft??"—"}</td><td>${x.costCharged??"—"}</td>`;
      tbody.appendChild(tr);
    });
    if (!list.length) tbody.innerHTML = '<tr><td colspan="6" class="muted">No logs</td></tr>';
  }
  if ($("logSearch")) $("logSearch").oninput = () => renderLogs();
  if ($("logSort")) $("logSort").onchange = () => renderLogs();

  function renderPass() {
    const tbody = $("passTable");
    tbody.innerHTML = "";
    Object.entries(allPass || {}).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0)).forEach(([id, r]) => {
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
    $("setApproveMsg").value = s.approveMessage || "";
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

  function startLive() {
    db.ref("users").on("value", (s) => { allUsers = s.val() || {}; refreshTab(document.querySelector(".nav.active")?.dataset.tab || "dashboard"); });
    db.ref("token_requests").on("value", (s) => { allTokenReqs = s.val() || {}; });
    db.ref("distributors").on("value", (s) => { allDists = s.val() || {}; });
    db.ref("usage_logs").on("value", (s) => { allLogs = s.val() || {}; });
    db.ref("settings").on("value", (s) => { settings = s.val() || {}; });
  }

  try {
    initFirebase();
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        show($("loginPage"), false);
        show($("app"), true);
        $("adminEmail").textContent = user.email || user.uid;
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
