/* Farmer ID Pro — Secure Admin (Firebase Auth + RTDB) */
(function () {
  "use strict";

  let auth, db;
  let allUsers = {}, allTokenReqs = {}, settings = {};

  function $(id) { return document.getElementById(id); }
  function show(el, on) { if (el) el.classList.toggle("hidden", !on); }
  function esc(s) {
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function initFirebase() {
    if (typeof firebase === "undefined") throw new Error("Firebase SDK missing");
    if (!window.FIREBASE_CONFIG || window.FIREBASE_CONFIG.apiKey === "PASTE_API_KEY") {
      throw new Error("firebase-config.js me Firebase API key paste karein");
    }
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.database();
  }

  async function fbGet(path) {
    const snap = await db.ref(path).once("value");
    return snap.val();
  }
  async function fbSet(path, data) { await db.ref(path).set(data); return true; }
  async function fbUpdate(path, data) { await db.ref(path).update(data); return true; }

  // ---- Auth ----
  $("btnLogin").onclick = async () => {
    const err = $("loginError");
    show(err, false);
    const email = $("loginEmail").value.trim();
    const pass = $("loginPass").value;
    const btn = $("btnLogin");
    btn.disabled = true; btn.textContent = "Logging in…";
    try {
      initFirebase();
      await auth.signInWithEmailAndPassword(email, pass);
    } catch (e) {
      err.textContent = e.message || String(e);
      show(err, true);
    }
    btn.disabled = false; btn.textContent = "Login";
  };
  $("loginPass").onkeydown = (e) => { if (e.key === "Enter") $("btnLogin").click(); };
  $("btnLogout").onclick = async () => { try { await auth.signOut(); } catch (e) {} };

  // ---- Tabs ----
  document.querySelectorAll(".nav").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".nav").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab").forEach((t) => t.classList.add("hidden"));
      const id = "tab-" + btn.dataset.tab;
      show($(id), true);
      $("pageTitle").textContent = btn.textContent.replace(/^[^\s]+\s/, "");
      if (btn.dataset.tab === "retailers") renderRetailers();
      if (btn.dataset.tab === "pending") renderPending();
      if (btn.dataset.tab === "tokens") renderTokens();
      if (btn.dataset.tab === "settings" || btn.dataset.tab === "payments") fillSettings();
    };
  });

  $("btnRefresh").onclick = () => loadAll();
  $("retSearch") && ($("retSearch").oninput = () => renderRetailers());
  $("tokFilter") && ($("tokFilter").onchange = () => renderTokens());

  // ---- Load ----
  async function loadAll() {
    try {
      allUsers = (await fbGet("users")) || {};
      allTokenReqs = (await fbGet("token_requests")) || {};
      settings = (await fbGet("settings")) || {};
      const st = $("dbStatus");
      st.textContent = "DB Connected";
      st.className = "badge ok";
      renderDashboard();
      renderRetailers();
      renderPending();
      renderTokens();
      fillSettings();
    } catch (e) {
      const st = $("dbStatus");
      st.textContent = "DB Error: " + (e.message || e);
      st.className = "badge err";
    }
  }

  function renderDashboard() {
    const users = Object.values(allUsers || {});
    const reqs = Object.values(allTokenReqs || {});
    $("sRetailers").textContent = users.filter((u) => u && u.status !== "pending").length;
    $("sActive").textContent = users.filter((u) => u && u.status === "active").length;
    $("sPending").textContent = users.filter((u) => u && u.status === "pending").length;
    $("sTokPend").textContent = reqs.filter((r) => r && (r.status || "pending") === "pending").length;
    $("sTokTemp").textContent = reqs.filter((r) => r && r.status === "temp_approved").length;
    let sale = 0;
    reqs.forEach((r) => {
      if (r && r.status === "approved") sale += Number(r.totalAmount) || 0;
    });
    $("sSale").textContent = "₹" + sale;
  }

  function renderRetailers() {
    const q = (($("retSearch") && $("retSearch").value) || "").toLowerCase();
    const tbody = $("retTable");
    if (!tbody) return;
    tbody.innerHTML = "";
    let list = Object.entries(allUsers || {}).filter(([, u]) => u && u.status !== "pending");
    if (q) {
      list = list.filter(([, u]) =>
        (u.name || "").toLowerCase().includes(q) || String(u.mobile || "").includes(q)
      );
    }
    list.sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">No retailers</td></tr>';
      return;
    }
    list.forEach(([uid, u]) => {
      const tr = document.createElement("tr");
      const st = u.status || "—";
      const pill =
        st === "active" ? "pill-ok" : st === "blocked" ? "pill-bad" : "pill-pend";
      tr.innerHTML = `
        <td><b>${esc(u.name)}</b>${u.awaitingFinalApprove ? ' <span class="pill pill-temp">auto</span>' : ""}</td>
        <td>${esc(u.mobile)}</td>
        <td><b>${u.tokens || 0}</b></td>
        <td><span class="pill ${pill}">${esc(st)}</span></td>
        <td>${u.autoApprovePayments ? "⚡ ON" : "OFF"}</td>
        <td>
          <button class="btn btn-sm" data-a="auto" data-id="${esc(uid)}">${u.autoApprovePayments ? "Auto OFF" : "Auto ON"}</button>
          <button class="btn btn-sm" data-a="add" data-id="${esc(uid)}">+ Token</button>
          <button class="btn btn-sm" data-a="final" data-id="${esc(uid)}">Final</button>
          <button class="btn btn-sm btn-danger" data-a="block" data-id="${esc(uid)}">${st === "blocked" ? "Unblock" : "Block"}</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = async (e) => {
      const b = e.target.closest("button[data-a]");
      if (!b) return;
      const id = b.getAttribute("data-id");
      const a = b.getAttribute("data-a");
      const u = allUsers[id];
      if (!u) return;
      if (a === "auto") {
        await fbUpdate("users/" + id, { autoApprovePayments: !u.autoApprovePayments });
        await loadAll();
      } else if (a === "add") {
        const n = prompt("Kitne tokens add?", "10");
        if (n == null) return;
        const qty = parseInt(n, 10);
        if (!qty || qty < 1) return alert("Invalid");
        const tokens = (u.tokens || 0) + qty;
        const history = Array.isArray(u.tokenHistory) ? u.tokenHistory.slice() : [];
        history.push({ type: "credit", amount: qty, reason: "Admin credit", timestamp: Date.now(), balanceAfter: tokens });
        await fbUpdate("users/" + id, { tokens, tokenHistory: history });
        await loadAll();
      } else if (a === "final") {
        const n = prompt("Final approve — free tokens?", "2");
        if (n == null) return;
        const free = parseInt(n, 10) || 0;
        const tokens = (u.tokens || 0) + free;
        await fbUpdate("users/" + id, {
          status: "active",
          tokens,
          freeTokens: (u.freeTokens || 0) + free,
          awaitingFinalApprove: false,
          approvedAt: Date.now(),
          finalApprovedAt: Date.now()
        });
        await loadAll();
      } else if (a === "block") {
        const next = u.status === "blocked" ? "active" : "blocked";
        await fbUpdate("users/" + id, { status: next });
        await loadAll();
      }
    };
  }

  function renderPending() {
    const tbody = $("pendTable");
    if (!tbody) return;
    tbody.innerHTML = "";
    const list = Object.entries(allUsers || {})
      .filter(([, u]) => u && u.status === "pending")
      .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No pending registrations</td></tr>';
      return;
    }
    list.forEach(([uid, u]) => {
      const tr = document.createElement("tr");
      const d = u.createdAt ? new Date(u.createdAt).toLocaleString("en-IN") : "—";
      tr.innerHTML = `
        <td>${esc(u.name)}</td><td>${esc(u.mobile)}</td>
        <td class="muted">${esc((u.address || "").slice(0, 40))}</td>
        <td class="muted">${d}</td>
        <td>
          <button class="btn btn-sm btn-primary" data-a="approve" data-id="${esc(uid)}">Activate</button>
          <button class="btn btn-sm btn-danger" data-a="del" data-id="${esc(uid)}">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = async (e) => {
      const b = e.target.closest("button[data-a]");
      if (!b) return;
      const id = b.getAttribute("data-id");
      if (b.getAttribute("data-a") === "approve") {
        const n = prompt("Free tokens on activate?", "0");
        if (n == null) return;
        const free = parseInt(n, 10) || 0;
        await fbUpdate("users/" + id, {
          status: "active",
          tokens: free,
          freeTokens: free,
          approvedAt: Date.now(),
          awaitingFinalApprove: false
        });
        await loadAll();
      } else {
        if (!confirm("Delete user?")) return;
        await fbSet("users/" + id, null);
        await loadAll();
      }
    };
  }

  function isValidUtr(utr) {
    const u = String(utr || "").replace(/\s+/g, "");
    if (/^T\d{22}$/i.test(u)) return true;
    if (/^\d{12}$/.test(u) || /^\d{16}$/.test(u)) return true;
    if (/^pay_[A-Za-z0-9]{10,}$/.test(u)) return true;
    return false;
  }

  function renderTokens() {
    const tbody = $("tokTable");
    if (!tbody) return;
    const filt = ($("tokFilter") && $("tokFilter").value) || "";
    tbody.innerHTML = "";
    let list = Object.entries(allTokenReqs || {});
    if (filt) list = list.filter(([, r]) => (r.status || "pending") === filt);
    list.sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    list = list.slice(0, 80);
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="muted">No requests</td></tr>';
      return;
    }
    list.forEach(([rid, r]) => {
      const st = r.status || "pending";
      const pill =
        st === "approved" ? "pill-ok" :
        st === "temp_approved" ? "pill-temp" :
        st === "rejected" ? "pill-bad" : "pill-pend";
      const d = r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN") : "—";
      let actions = "";
      if (st === "pending") {
        actions = `
          <button class="btn btn-sm btn-warn" data-a="temp" data-id="${esc(rid)}">Temp</button>
          <button class="btn btn-sm btn-primary" data-a="final" data-id="${esc(rid)}">Final</button>
          <button class="btn btn-sm btn-danger" data-a="rej" data-id="${esc(rid)}">Reject</button>`;
      } else if (st === "temp_approved") {
        actions = `
          <button class="btn btn-sm btn-primary" data-a="final" data-id="${esc(rid)}">Final</button>
          <button class="btn btn-sm btn-danger" data-a="rej" data-id="${esc(rid)}">Reject</button>
          <button class="btn btn-sm btn-danger" data-a="del" data-id="${esc(rid)}">Del</button>`;
      } else {
        actions = `<button class="btn btn-sm btn-danger" data-a="del" data-id="${esc(rid)}">Del</button>`;
      }
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="muted">${d}</td>
        <td>${esc(r.userName)}</td>
        <td>${esc(r.userMobile)}</td>
        <td><b>${r.amount || 0}</b></td>
        <td>₹${r.totalAmount || 0}</td>
        <td><code>${esc(r.utr || "—")}</code></td>
        <td><span class="pill ${pill}">${esc(st)}</span></td>
        <td>${actions}</td>`;
      tbody.appendChild(tr);
    });
    tbody.onclick = async (e) => {
      const b = e.target.closest("button[data-a]");
      if (!b) return;
      const rid = b.getAttribute("data-id");
      const r = allTokenReqs[rid];
      if (!r) return;
      const a = b.getAttribute("data-a");
      if (a === "temp") await tempApprove(rid, r);
      else if (a === "final") await finalApprove(rid, r);
      else if (a === "rej") await rejectReq(rid, r);
      else if (a === "del") await deleteReq(rid, r);
      await loadAll();
    };
  }

  async function creditUser(userId, qty, reason, rid) {
    const user = allUsers[userId];
    if (!user) throw new Error("User not found");
    const tokens = (user.tokens || 0) + qty;
    const history = Array.isArray(user.tokenHistory) ? user.tokenHistory.slice() : [];
    history.push({ type: qty >= 0 ? "credit" : "debit", amount: Math.abs(qty), reason, requestId: rid, timestamp: Date.now(), balanceAfter: tokens });
    await fbUpdate("users/" + userId, { tokens, tokenHistory: history });
  }

  async function tempApprove(rid, r) {
    if ((r.status || "pending") !== "pending") return alert("Already processed");
    const qty = parseInt(r.amount, 10) || 0;
    await creditUser(r.userId, qty, "Temp-approved payment", rid);
    await fbUpdate("token_requests/" + rid, {
      status: "temp_approved",
      tempApprovedAt: Date.now(),
      autoApproved: false
    });
  }

  async function finalApprove(rid, r) {
    const st = r.status || "pending";
    if (st === "pending") {
      const qty = parseInt(r.amount, 10) || 0;
      await creditUser(r.userId, qty, "Final approved payment", rid);
    }
    await fbUpdate("token_requests/" + rid, {
      status: "approved",
      approvedAt: Date.now(),
      finalApprovedAt: Date.now()
    });
  }

  async function rejectReq(rid, r) {
    if (!confirm("Reject request?")) return;
    if (r.status === "temp_approved" || r.status === "approved") {
      const qty = parseInt(r.amount, 10) || 0;
      await creditUser(r.userId, -qty, "Request rejected clawback", rid);
    }
    await fbUpdate("token_requests/" + rid, { status: "rejected", rejectedAt: Date.now() });
  }

  async function deleteReq(rid, r) {
    if (!confirm("Delete request?")) return;
    if (r.status === "temp_approved" || r.status === "approved") {
      const qty = parseInt(r.amount, 10) || 0;
      await creditUser(r.userId, -qty, "Request deleted clawback", rid);
    }
    await fbSet("token_requests/" + rid, null);
  }

  function fillSettings() {
    const s = settings || {};
    if ($("setAutoPay")) $("setAutoPay").value = s.autoApproveEnabled ? "1" : "0";
    if ($("setAutoRet")) $("setAutoRet").value = s.autoTempApproveRetailer ? "1" : "0";
    if ($("setTokenCost")) $("setTokenCost").value = s.tokenCost != null ? s.tokenCost : 1;
    if ($("setFreeGen")) $("setFreeGen").value = s.freeGenerateEnabled ? "1" : "0";
    if ($("setWa")) $("setWa").value = s.whatsappNumber || "";
    if ($("setBuyMsg")) $("setBuyMsg").value = s.buyMessage || "";
    if ($("setUpi")) $("setUpi").value = s.upiLink || "";
    if ($("rate1")) $("rate1").value = s.rate1to5 != null ? s.rate1to5 : 20;
    if ($("rate2")) $("rate2").value = s.rate6to10 != null ? s.rate6to10 : 15;
    if ($("rate3")) $("rate3").value = s.rate11plus != null ? s.rate11plus : 10;
    if ($("setMoreEn")) $("setMoreEn").value = s.moreServiceEnabled ? "1" : "0";
    if ($("setMoreLabel")) $("setMoreLabel").value = s.moreServiceLabel || "More Service";
    if ($("setMoreUrl")) $("setMoreUrl").value = s.moreServiceUrl || "";
    if ($("rzpEn")) $("rzpEn").value = s.razorpayEnabled ? "1" : "0";
    if ($("rzpKey")) $("rzpKey").value = s.razorpayKeyId || "";
    if ($("rzpSecret")) $("rzpSecret").value = s.razorpayKeySecret || "";
  }

  $("btnSaveAuto").onclick = async () => {
    await fbUpdate("settings", {
      autoApproveEnabled: $("setAutoPay").value === "1",
      autoTempApproveRetailer: $("setAutoRet").value === "1",
      tokenCost: parseInt($("setTokenCost").value, 10) || 0,
      freeGenerateEnabled: $("setFreeGen").value === "1"
    });
    alert("Auto settings saved");
    await loadAll();
  };
  $("btnSaveSupport").onclick = async () => {
    await fbUpdate("settings", {
      whatsappNumber: $("setWa").value.trim(),
      buyMessage: $("setBuyMsg").value.trim(),
      upiLink: $("setUpi").value.trim()
    });
    alert("Support saved");
    await loadAll();
  };
  $("btnSaveRates").onclick = async () => {
    await fbUpdate("settings", {
      rate1to5: parseFloat($("rate1").value) || 20,
      rate6to10: parseFloat($("rate2").value) || 15,
      rate11plus: parseFloat($("rate3").value) || 10
    });
    alert("Rates saved");
    await loadAll();
  };
  $("btnSaveMore").onclick = async () => {
    await fbUpdate("settings", {
      moreServiceEnabled: $("setMoreEn").value === "1",
      moreServiceLabel: $("setMoreLabel").value.trim() || "More Service",
      moreServiceUrl: $("setMoreUrl").value.trim()
    });
    alert("More Service saved");
    await loadAll();
  };
  $("btnSaveRzp").onclick = async () => {
    const en = $("rzpEn").value === "1";
    const key = $("rzpKey").value.trim();
    if (en && !key) return alert("Key ID required");
    await fbUpdate("settings", {
      razorpayEnabled: en,
      razorpayKeyId: key,
      razorpayKeySecret: $("rzpSecret").value.trim()
    });
    alert(en ? "Razorpay ON" : "Razorpay OFF — manual refill only");
    await loadAll();
  };

  // Live listeners
  function startLive() {
    db.ref("users").on("value", (s) => { allUsers = s.val() || {}; renderDashboard(); renderRetailers(); renderPending(); });
    db.ref("token_requests").on("value", (s) => { allTokenReqs = s.val() || {}; renderDashboard(); renderTokens(); });
    db.ref("settings").on("value", (s) => { settings = s.val() || {}; fillSettings(); });
  }

  // Boot
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
