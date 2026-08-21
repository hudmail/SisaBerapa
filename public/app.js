// ============================================================
// SisaBerapa? — app.js
// Client-side logic: routing, data fetching, rendering, charts
// ============================================================

// --- Auth: redirect to login if the session expires mid-use ---
(function () {
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await originalFetch(...args);
    const url = args[0] ? args[0].toString() : "";
    if (res.status === 401 && !url.includes("/api/login")) {
      window.location.href = "/login.html";
    }
    return res;
  };
})();

// --- Constants ---
const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// --- State ---
let transactions = [];
let summary = null;
let categories = [];
let goals = [];
let reminders = [];
let currentPage = "dashboard";
let txType = "expense";
let cashflowChart = null;
let categoryChart = null;
let laporanCashflowChartInstance = null;
let laporanCategoryChartInstance = null;
let searchTerm = "";
let dashFilter = "all";
let txFilter = "all";

const now = new Date();
let selectedYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

// --- Helpers ---
const el = (id) => document.getElementById(id);
const fmtRupiah = (n) => "Rp" + Math.abs(Math.round(n)).toLocaleString("id-ID");
const fmtRupiahSigned = (n) => (n < 0 ? "-" : "+") + fmtRupiah(n);

// VULN-003 FIX: Escape HTML untuk mencegah XSS di innerHTML
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function monthLabel(ym) {
  const [y, m] = ym.split("-");
  return `${MONTHS_ID[parseInt(m, 10) - 1]} ${y}`;
}

function monthLabelShort(ym) {
  const [y, m] = ym.split("-");
  return `${MONTHS_SHORT[parseInt(m, 10) - 1]} '${y.slice(2)}`;
}

function shiftMonth(delta) {
  const [y, m] = selectedYM.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  selectedYM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  loadData();
}

function pctChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function getCatInfo(catName) {
  const found = categories.find(c => c.name === catName);
  if (found) return found;
  return { name: catName, type: 'expense', icon: 'ph-fill ph-dots-three-outline', color_bg: 'bg-gray-100', color_text: 'text-gray-500', color_hex: '#94a3b8', budget: 0 };
}

function getCatColor(catName) {
  const info = getCatInfo(catName);
  return { bg: info.color_bg, text: info.color_text, hex: info.color_hex };
}

function getCatIcon(catName) {
  return getCatInfo(catName).icon;
}

function formatDateDisplay(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${parseInt(d)} ${MONTHS_SHORT[parseInt(m) - 1]} ${y}`;
}

// --- Toast ---
function showToast(message, type = "success") {
  const container = el("toastContainer");
  const toast = document.createElement("div");
  const icon = type === "success" ? "ph-fill ph-check-circle text-brand-600" : "ph-fill ph-warning text-expense";
  const bg = type === "success" ? "bg-brand-50 border-brand-200" : "bg-rose-50 border-red-200";
  toast.className = `toast-enter pointer-events-auto px-4 py-3 rounded-xl border ${bg} shadow-lg flex items-center gap-3 text-sm font-medium text-gray-800 min-w-[280px]`;
  toast.innerHTML = `<i class="${icon} text-xl"></i><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove("toast-enter");
    toast.classList.add("toast-exit");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- Banner ---
function showBanner(msg) {
  const b = el("banner");
  el("bannerText").textContent = msg;
  b.classList.remove("hidden");
}
function hideBanner() {
  el("banner").classList.add("hidden");
}

// --- Navigation ---
function navigateTo(page) {
  currentPage = page;

  // Hide all pages
  document.querySelectorAll(".page-section").forEach((p) => p.classList.add("hidden"));
  const target = el(`page-${page}`);
  if (target) {
    target.classList.remove("hidden");
    // Re-trigger animation
    target.style.animation = "none";
    target.offsetHeight; // force reflow
    target.style.animation = "";
  }

  // Update sidebar active states
  document.querySelectorAll("#sidebarNav .nav-link, #mobileSidebarNav .nav-link").forEach((link) => {
    const linkPage = link.dataset.page;
    if (linkPage === page) {
      link.className = "nav-link active flex items-center gap-3 px-3 py-2.5 rounded-lg bg-brand-50 text-brand-700 font-medium transition-colors";
      // Replace icon to filled variant
      const icon = link.querySelector("i");
      if (icon) icon.className = icon.className.replace(" ph ", " ph-fill ");
    } else {
      link.className = "nav-link flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-900 font-medium transition-colors";
      const icon = link.querySelector("i");
      if (icon) icon.className = icon.className.replace(" ph-fill ", " ph ");
    }
  });

  // Close mobile sidebar if open
  closeMobileSidebar();

  // Render page-specific content
  if (page === "transaksi") renderTransactionPage();
  if (page === "dashboard") renderDashboard();
  if (page === "budget") renderBudgetPage();
  if (page === "laporan") renderLaporanPage();
  if (page === "kategori") renderKategoriPage();
  if (page === "tujuan") renderTujuanPage();
  if (page === "pengingat") renderPengingatPage();
}

// --- Mobile Sidebar ---
function openMobileSidebar() {
  el("mobileSidebar").classList.remove("-translate-x-full");
  el("mobileSidebarOverlay").classList.remove("hidden");
}
function closeMobileSidebar() {
  el("mobileSidebar").classList.add("-translate-x-full");
  el("mobileSidebarOverlay").classList.add("hidden");
}

// --- Drawer ---
function toggleDrawer() {
  const drawer = el("txDrawer");
  const backdrop = el("drawerBackdrop");

  if (drawer.classList.contains("translate-x-full")) {
    // Open
    backdrop.classList.remove("hidden");
    setTimeout(() => {
      backdrop.classList.remove("opacity-0");
      drawer.classList.remove("translate-x-full");
    }, 10);
    // Set default date
    el("txDate").valueAsDate = new Date();
    // Set default type
    const expenseRadio = document.querySelector('input[name="drawerTxType"][value="expense"]');
    if (expenseRadio) expenseRadio.checked = true;
    txType = "expense";
    populateCategories();
  } else {
    // Close
    drawer.classList.add("translate-x-full");
    backdrop.classList.add("opacity-0");
    setTimeout(() => {
      backdrop.classList.add("hidden");
    }, 300);
    el("addTxForm").reset();
    el("txAmount").value = "";
  }
}

// --- Data Loading ---
async function loadTransactions() {
  try {
    const res = await fetch("/api/transactions");
    if (!res.ok) throw new Error("bad status");
    transactions = await res.json();
  } catch (e) {
    showBanner("Gagal memuat data dari server. Cek koneksi ke server.");
    transactions = [];
  }
}

async function loadSummary() {
  try {
    const res = await fetch(`/api/summary?month=${selectedYM}`);
    if (!res.ok) throw new Error("bad status");
    summary = await res.json();
  } catch (e) {
    summary = null;
  }
}

async function loadCategories() {
  try {
    const res = await fetch("/api/categories");
    if (!res.ok) throw new Error("bad status");
    categories = await res.json();
  } catch (e) {
    categories = [];
  }
}

async function loadGoals() {
  try {
    const res = await fetch("/api/goals");
    if (!res.ok) throw new Error("bad status");
    goals = await res.json();
  } catch (e) {
    goals = [];
  }
}

async function loadReminders() {
  try {
    const res = await fetch("/api/reminders");
    if (!res.ok) throw new Error("bad status");
    reminders = await res.json();
  } catch (e) {
    reminders = [];
  }
}

async function loadData() {
  await Promise.all([
    loadTransactions(),
    loadSummary(),
    loadCategories(),
    loadGoals(),
    loadReminders()
  ]);
  el("monthLabel").textContent = monthLabel(selectedYM);
  
  if (currentPage === "dashboard") renderDashboard();
  if (currentPage === "transaksi") renderTransactionPage();
  if (currentPage === "budget") renderBudgetPage();
  if (currentPage === "laporan") renderLaporanPage();
  if (currentPage === "kategori") renderKategoriPage();
  if (currentPage === "tujuan") renderTujuanPage();
  if (currentPage === "pengingat") renderPengingatPage();
}

// --- Add Transaction ---
async function addTransaction(payload) {
  try {
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("bad status");
    const created = await res.json();
    transactions.unshift(created);
    await loadSummary(); // refresh summary
    renderDashboard();
    if (currentPage === "transaksi") renderTransactionPage();
    showToast("Transaksi berhasil disimpan!");
  } catch (e) {
    showToast("Gagal menyimpan transaksi.", "error");
  }
}

// --- Delete Transaction ---
async function deleteTransaction(id) {
  if (!confirm("Yakin ingin menghapus transaksi ini?")) return;
  try {
    const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("bad status");
    transactions = transactions.filter((t) => t.id !== id);
    await loadSummary();
    renderDashboard();
    if (currentPage === "transaksi") renderTransactionPage();
    showToast("Transaksi berhasil dihapus!");
  } catch (e) {
    showToast("Gagal menghapus transaksi.", "error");
  }
}

// --- Filter Helpers ---
function monthTx() {
  return transactions.filter((t) => t.date.slice(0, 7) === selectedYM);
}

function allTimeBalance() {
  if (summary) return summary.balance;
  let bal = 0;
  for (const t of transactions) bal += t.type === "income" ? t.amount : -t.amount;
  return bal;
}

// --- Categories ---
function populateCategories() {
  const sel = el("txCategory");
  sel.innerHTML = "";
  categories.filter(c => c.type === txType).forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
}

// --- Dashboard Rendering ---
function renderDashboard() {
  if (currentPage !== "dashboard") return;

  // KPI
  const balance = allTimeBalance();
  const mtx = monthTx();
  let income = 0, expense = 0;
  for (const t of mtx) {
    if (t.type === "income") income += t.amount;
    else expense += t.amount;
  }
  const net = income - expense;

  const saldoEl = el("kpiSaldo");
  saldoEl.textContent = (balance < 0 ? "-" : "") + fmtRupiah(balance);
  saldoEl.className = "text-2xl font-bold mb-3 tabular-nums " + (balance < 0 ? "text-expense" : "text-gray-900");
  el("kpiIncome").textContent = fmtRupiah(income);
  el("kpiExpense").textContent = fmtRupiah(expense);
  
  const netEl = el("kpiNet");
  netEl.textContent = (net < 0 ? "-" : "") + fmtRupiah(net);
  netEl.className = "text-2xl font-bold mb-3 tabular-nums " + (net >= 0 ? "text-brand-600" : "text-expense");

  // KPI Change indicators
  if (summary) {
    const prevMonth = summary.prevMonth;
    const prevLabel = monthLabel(prevMonth);

    const incomePct = pctChange(income, summary.prevIncome);
    const expensePct = pctChange(expense, summary.prevExpense);

    el("kpiIncomeChange").innerHTML = renderChangeIndicator(incomePct, prevLabel, true);
    el("kpiExpenseChange").innerHTML = renderChangeIndicator(expensePct, prevLabel, false);
    el("kpiSaldoChange").innerHTML = "";
  }

  // Charts
  renderCashflowChart();
  renderCategoryChart(mtx, expense);

  // Recent transactions table
  renderDashTxTable(mtx);

  // Budget
  renderBudget(mtx);

  // Insight
  renderInsight(mtx);
}

function renderChangeIndicator(pct, prevLabel, higherIsGood) {
  const isUp = pct > 0;
  const isGood = higherIsGood ? isUp : !isUp;
  const color = pct === 0 ? "text-gray-400" : (isGood ? "text-brand-600" : "text-expense");
  const arrow = pct === 0 ? "" : (isUp ? '<i class="ph-bold ph-arrow-up"></i>' : '<i class="ph-bold ph-arrow-down"></i>');
  return `<span class="${color} flex items-center gap-1">${arrow} ${Math.abs(pct)}%</span> <span class="text-gray-400 font-normal ml-1">dari ${prevLabel}</span>`;
}

// --- Dashboard Transaction Table ---
function renderDashTxTable(mtx) {
  const sorted = [...mtx].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  let filtered = sorted;
  if (dashFilter !== "all") {
    filtered = sorted.filter((t) => t.type === dashFilter);
  }

  // Show only 5 most recent
  const display = filtered.slice(0, 5);

  const tbody = el("dashTxTable");
  tbody.innerHTML = "";
  el("dashEmptyState").classList.toggle("hidden", display.length !== 0);

  for (const t of display) {
    const isIncome = t.type === "income";
    const colorClass = isIncome ? "text-brand-600" : "text-expense";
    const sign = isIncome ? "+" : "-";
    const catColor = getCatColor(t.category);
    const catIcon = getCatIcon(t.category);

    const tr = document.createElement("tr");
    tr.className = "hover:bg-gray-50/50 transition-colors group cursor-pointer";
    tr.innerHTML = `
      <td class="px-5 py-3.5 text-gray-500 whitespace-nowrap text-xs">${formatDateDisplay(t.date)}</td>
      <td class="px-5 py-3.5">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-full ${catColor.bg} ${catColor.text} flex items-center justify-center"><i class="${catIcon} text-xs"></i></div>
          <span class="text-gray-700 text-xs font-medium"></span>
        </div>
      </td>
      <td class="px-5 py-3.5 text-gray-900 text-xs font-medium max-w-[200px] truncate"></td>
      <td class="px-5 py-3.5 text-gray-500 text-xs">${escapeHtml(t.method || "Tunai")}</td>
      <td class="px-5 py-3.5 text-right font-medium ${colorClass} tabular-nums text-xs">${sign}${fmtRupiah(t.amount)}</td>
      <td class="px-4 py-3.5 text-right">
        <button class="delete-btn text-gray-300 hover:text-expense opacity-0 group-hover:opacity-100 transition-all" aria-label="Hapus">
          <i class="ph ph-trash text-base"></i>
        </button>
      </td>
    `;
    tr.querySelector("td:nth-child(2) span").textContent = t.category;
    tr.querySelector("td:nth-child(3)").textContent = t.note || "-";
    tr.querySelector(".delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteTransaction(t.id);
    });
    tbody.appendChild(tr);
  }
}

// --- Full Transaction Page ---
function renderTransactionPage() {
  const sorted = [...monthTx()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  
  let filtered = sorted;
  if (txFilter !== "all") {
    filtered = sorted.filter((t) => t.type === txFilter);
  }
  if (searchTerm) {
    filtered = filtered.filter(
      (t) =>
        t.category.toLowerCase().includes(searchTerm) ||
        (t.note || "").toLowerCase().includes(searchTerm) ||
        (t.method || "").toLowerCase().includes(searchTerm)
    );
  }

  el("txCountLabel").textContent = `${filtered.length} transaksi`;
  const tbody = el("fullTxTable");
  tbody.innerHTML = "";
  el("fullEmptyState").classList.toggle("hidden", filtered.length !== 0);

  for (const t of filtered) {
    const isIncome = t.type === "income";
    const colorClass = isIncome ? "text-brand-600" : "text-expense";
    const sign = isIncome ? "+" : "-";
    const catColor = getCatColor(t.category);
    const catIcon = getCatIcon(t.category);

    const tr = document.createElement("tr");
    tr.className = "hover:bg-gray-50/50 transition-colors group";
    tr.innerHTML = `
      <td class="px-5 py-3.5 text-gray-500 whitespace-nowrap text-xs">${formatDateDisplay(t.date)}</td>
      <td class="px-5 py-3.5">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-full ${catColor.bg} ${catColor.text} flex items-center justify-center"><i class="${catIcon} text-xs"></i></div>
          <span class="text-gray-700 text-xs font-medium"></span>
        </div>
      </td>
      <td class="px-5 py-3.5 text-gray-900 text-xs font-medium max-w-[200px] truncate"></td>
      <td class="px-5 py-3.5 text-gray-500 text-xs">${escapeHtml(t.method || "Tunai")}</td>
      <td class="px-5 py-3.5 text-right font-medium ${colorClass} tabular-nums text-xs">${sign}${fmtRupiah(t.amount)}</td>
      <td class="px-4 py-3.5 text-right">
        <button class="delete-btn text-gray-300 hover:text-expense opacity-0 group-hover:opacity-100 transition-all" aria-label="Hapus">
          <i class="ph ph-trash text-base"></i>
        </button>
      </td>
    `;
    tr.querySelector("td:nth-child(2) span").textContent = t.category;
    tr.querySelector("td:nth-child(3)").textContent = t.note || "-";
    tr.querySelector(".delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteTransaction(t.id);
    });
    tbody.appendChild(tr);
  }
}

// --- Charts ---
function renderCashflowChart() {
  if (!summary || !summary.monthlyData) return;

  const labels = summary.monthlyData.map((d) => monthLabelShort(d.month));
  const incomeData = summary.monthlyData.map((d) => d.income);
  const expenseData = summary.monthlyData.map((d) => d.expense);
  const balanceData = summary.balanceByMonth || [];

  if (cashflowChart) cashflowChart.destroy();
  
  // Set Chart.js defaults
  Chart.defaults.font.family = '"Inter", sans-serif';
  Chart.defaults.color = '#94a3b8';

  const ctx = el("cashflowChart").getContext("2d");
  cashflowChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "line",
          label: "Saldo",
          data: balanceData,
          borderColor: "#94a3b8",
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.4,
          pointBackgroundColor: "#94a3b8",
          pointRadius: 3,
          pointHoverRadius: 5,
          fill: false,
          order: 1,
        },
        {
          type: "bar",
          label: "Pemasukan",
          data: incomeData,
          backgroundColor: "#22c55e",
          borderRadius: 4,
          barPercentage: 0.6,
          categoryPercentage: 0.5,
          order: 2,
        },
        {
          type: "bar",
          label: "Pengeluaran",
          data: expenseData,
          backgroundColor: "#ef4444",
          borderRadius: 4,
          barPercentage: 0.6,
          categoryPercentage: 0.5,
          order: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: "index",
          intersect: false,
          backgroundColor: "rgba(255, 255, 255, 0.95)",
          titleColor: "#1e293b",
          bodyColor: "#475569",
          borderColor: "#e2e8f0",
          borderWidth: 1,
          padding: 10,
          boxPadding: 4,
          callbacks: {
            label: function (context) {
              let label = context.dataset.label || "";
              if (label) label += ": ";
              if (context.parsed.y !== null) {
                label += "Rp" + context.parsed.y.toLocaleString("id-ID");
              }
              return label;
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: "#f1f5f9" },
          ticks: {
            callback: (val) => {
              if (val === 0) return "Rp0";
              return "Rp" + (val / 1000000).toLocaleString("id-ID") + "jt";
            },
            font: { size: 11 },
          },
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
      interaction: { mode: "index", intersect: false },
    },
  });
}

function renderCategoryChart(mtx, totalExpense) {
  const map = {};
  for (const t of mtx) {
    if (t.type !== "expense") continue;
    map[t.category] = (map[t.category] || 0) + t.amount;
  }
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);

  el("categoryEmpty").classList.toggle("hidden", entries.length !== 0);
  el("categoryChart").style.display = entries.length ? "block" : "none";
  el("categoryTotal").textContent = entries.length ? fmtRupiah(totalExpense) : "Rp0";

  if (categoryChart) categoryChart.destroy();
  if (entries.length) {
    const colors = entries.map((e) => {
      const c = getCatColor(e[0]);
      return c.hex;
    });

    const ctx = el("categoryChart").getContext("2d");
    categoryChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: entries.map((e) => e[0]),
        datasets: [
          {
            data: entries.map((e) => e[1]),
            backgroundColor: colors,
            borderWidth: 0,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "75%",
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(255, 255, 255, 0.95)",
            titleColor: "#1e293b",
            bodyColor: "#475569",
            borderColor: "#e2e8f0",
            borderWidth: 1,
            callbacks: {
              label: (ctx) => " " + ctx.label + ": " + fmtRupiah(ctx.parsed),
            },
          },
        },
      },
    });
  }

  // Legend
  const legend = el("categoryLegend");
  legend.innerHTML = "";
  entries.forEach(([cat, amt]) => {
    const pct = totalExpense ? Math.round((amt / totalExpense) * 100) : 0;
    const catColor = getCatColor(cat);
    const row = document.createElement("div");
    row.className = "flex justify-between items-center text-xs";
    row.innerHTML = `
      <div class="flex items-center gap-2 w-24">
        <div class="w-2 h-2 rounded-full" style="background:${catColor.hex}"></div>
        <span class="text-gray-700"></span>
      </div>
      <span class="text-gray-500 tabular-nums w-24 text-right">${fmtRupiah(amt)}</span>
      <span class="font-medium text-gray-900 tabular-nums">${pct}%</span>
    `;
    row.querySelector("span.text-gray-700").textContent = cat;
    legend.appendChild(row);
  });
}

// --- Budget ---
function renderBudget(mtx) {
  const expenseByCategory = {};
  for (const t of mtx) {
    if (t.type !== "expense") continue;
    expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + t.amount;
  }

  const container = el("budgetList");
  container.innerHTML = "";

  const expCats = categories.filter(c => c.type === 'expense');
  if (expCats.length === 0) {
    el("budgetEmpty").classList.remove("hidden");
    return;
  }
  el("budgetEmpty").classList.add("hidden");

  // Show top 4 budget items
  expCats.slice(0, 4).forEach(c => {
    const spent = expenseByCategory[c.name] || 0;
    const limit = c.budget || 0;
    const pct = limit > 0 ? Math.min(Math.round((spent / limit) * 100), 100) : 0;
    
    // Color the bar based on percentage
    let barColor = c.color_hex;
    let pctColor = c.color_text;
    if (pct >= 90) {
      barColor = "#ef4444";
      pctColor = "text-expense";
    } else if (pct >= 75) {
      barColor = "#f59e0b";
      pctColor = "text-amber-500";
    }

    const item = document.createElement("div");
    item.innerHTML = `
      <div class="flex justify-between items-end mb-1.5">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-lg ${c.color_bg} ${c.color_text} flex items-center justify-center"><i class="${c.icon} text-xs"></i></div>
          <span class="text-xs font-medium text-gray-700 budget-cat-name"></span>
        </div>
        <div class="text-[11px] text-gray-500 tabular-nums">${fmtRupiah(spent)} / ${limit > 0 ? fmtRupiah(limit) : 'Belum diatur'}</div>
      </div>
      <div class="flex items-center gap-3">
        <div class="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-all duration-500" style="width: ${pct}%; background: ${barColor}"></div>
        </div>
        <span class="text-xs font-bold ${pctColor} w-7 text-right">${pct}%</span>
      </div>
    `;
    item.querySelector(".budget-cat-name").textContent = c.name;
    container.appendChild(item);
  });
}

// --- Insight ---
function renderInsight(mtx) {
  const today = new Date().toISOString().slice(0, 10);
  const todayExpense = mtx.filter((t) => t.type === "expense" && t.date === today)
    .reduce((sum, t) => sum + t.amount, 0);

  const daysInMonth = mtx.length > 0
    ? new Set(mtx.filter((t) => t.type === "expense").map((t) => t.date)).size || 1
    : 1;
  const totalExpense = mtx.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
  const dailyAvg = totalExpense / daysInMonth;

  const insightEl = el("insightText");

  if (todayExpense === 0 && totalExpense === 0) {
    insightEl.textContent = "Belum ada transaksi bulan ini. Mulai catat pengeluaranmu! 📝";
  } else if (todayExpense === 0) {
    insightEl.textContent = "Belum ada pengeluaran hari ini. Hemat terus! 💪";
  } else if (todayExpense < dailyAvg) {
    const savedPct = Math.round(((dailyAvg - todayExpense) / dailyAvg) * 100);
    insightEl.textContent = `Pengeluaranmu hari ini lebih rendah ${savedPct}% dari rata-rata harianmu. Pertahankan! 💚`;
  } else {
    const overPct = Math.round(((todayExpense - dailyAvg) / dailyAvg) * 100);
    insightEl.textContent = `Pengeluaranmu hari ini ${overPct}% lebih tinggi dari rata-rata harianmu. Coba kurangi ya! ⚠️`;
  }
}

// --- Export CSV ---
function exportCSV() {
  const mtx = [...monthTx()].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (mtx.length === 0) {
    showToast("Tidak ada transaksi untuk diekspor.", "error");
    return;
  }
  const rows = [["Tanggal", "Tipe", "Kategori", "Keterangan", "Metode", "Jumlah"]];
  for (const t of mtx) {
    rows.push([
      t.date,
      t.type === "income" ? "Pemasukan" : "Pengeluaran",
      t.category,
      (t.note || "").replace(/"/g, '""'),
      t.method || "Tunai",
      t.amount,
    ]);
  }
  const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `buku-kas-${selectedYM}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("CSV berhasil diunduh!");
}

// --- Amount Formatting ---
function formatAmountInput(rawDigits) {
  if (!rawDigits) return "";
  return Number(rawDigits).toLocaleString("id-ID");
}
function getRawAmount() {
  return el("txAmount").value.replace(/\./g, "");
}

// ==================== NEW MODULES LOGIC ====================

// --- Drawers ---
function toggleCategoryDrawer() {
  const drawer = el("categoryDrawer");
  const backdrop = el("drawerBackdrop");
  if (drawer.classList.contains("translate-x-full")) {
    backdrop.classList.remove("hidden");
    setTimeout(() => { backdrop.classList.remove("opacity-0"); drawer.classList.remove("translate-x-full"); }, 10);
  } else {
    drawer.classList.add("translate-x-full");
    backdrop.classList.add("opacity-0");
    setTimeout(() => backdrop.classList.add("hidden"), 300);
    el("addCategoryForm").reset();
  }
}

function toggleGoalDrawer() {
  const drawer = el("goalDrawer");
  const backdrop = el("drawerBackdrop");
  if (drawer.classList.contains("translate-x-full")) {
    backdrop.classList.remove("hidden");
    setTimeout(() => { backdrop.classList.remove("opacity-0"); drawer.classList.remove("translate-x-full"); }, 10);
  } else {
    drawer.classList.add("translate-x-full");
    backdrop.classList.add("opacity-0");
    setTimeout(() => backdrop.classList.add("hidden"), 300);
    el("addGoalForm").reset();
  }
}

function toggleReminderDrawer() {
  const drawer = el("reminderDrawer");
  const backdrop = el("drawerBackdrop");
  if (drawer.classList.contains("translate-x-full")) {
    backdrop.classList.remove("hidden");
    setTimeout(() => { backdrop.classList.remove("opacity-0"); drawer.classList.remove("translate-x-full"); }, 10);
  } else {
    drawer.classList.add("translate-x-full");
    backdrop.classList.add("opacity-0");
    setTimeout(() => backdrop.classList.add("hidden"), 300);
    el("addReminderForm").reset();
  }
}

// --- Category Logic ---
async function saveCategory() {
  const payload = {
    name: el("catName").value,
    type: el("catType").value,
    icon: el("catIcon").value || "ph-fill ph-circle",
    color_bg: "bg-" + el("catColor").value + "-50",
    color_text: "text-" + el("catColor").value + "-500",
    color_hex: el("catColor").value === "brand" ? "#22c55e" : (el("catColor").value === "blue" ? "#3b82f6" : "#84cc16"), // simplified mapping
    budget: 0
  };
  try {
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    await loadCategories();
    renderKategoriPage();
    toggleCategoryDrawer();
    showToast("Kategori disimpan");
  } catch(e) { showToast("Gagal simpan kategori", "error"); }
}

async function deleteCategory(name) {
  if(!confirm("Hapus kategori " + name + "?")) return;
  try {
    await fetch("/api/categories/" + name, { method: "DELETE" });
    await loadCategories();
    renderKategoriPage();
    showToast("Kategori dihapus");
  } catch(e) { showToast("Gagal", "error"); }
}

function renderKategoriPage() {
  const ul = el("categoryList");
  ul.innerHTML = "";
  categories.forEach(c => {
    const li = document.createElement("li");
    li.className = "flex items-center justify-between p-4 hover:bg-gray-50 transition-colors";
    li.innerHTML = `
      <div class="flex items-center gap-4">
        <div class="w-10 h-10 rounded-xl ${c.color_bg} ${c.color_text} flex items-center justify-center">
          <i class="${c.icon} text-xl"></i>
        </div>
        <div>
          <p class="font-bold text-gray-900 cat-name"></p>
          <p class="text-xs text-gray-500 capitalize">${c.type === 'expense' ? 'Pengeluaran' : 'Pemasukan'}</p>
        </div>
      </div>
      <button class="delete-cat-btn text-gray-400 hover:text-red-500 p-2"><i class="ph ph-trash"></i></button>
    `;
    li.querySelector(".cat-name").textContent = c.name;
    li.querySelector(".delete-cat-btn").addEventListener("click", () => deleteCategory(c.name));
    ul.appendChild(li);
  });
}

// --- Goal Logic ---
async function saveGoal() {
  const payload = {
    name: el("goalName").value,
    target_amount: el("goalTarget").value,
    deadline: el("goalDeadline").value,
    icon: "ph-fill ph-target",
    color: "bg-amber-500"
  };
  try {
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    await loadGoals();
    renderTujuanPage();
    toggleGoalDrawer();
    showToast("Tujuan disimpan");
  } catch(e) { showToast("Gagal simpan tujuan", "error"); }
}

async function addGoalFunds(id) {
  const amount = prompt("Masukkan nominal tabungan (Rp):");
  if(!amount || isNaN(amount)) return;
  try {
    await fetch("/api/goals/" + id + "/add-funds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(amount) }),
    });
    await loadData();
    showToast("Dana ditambahkan & tercatat sebagai pengeluaran");
  } catch(e) { showToast("Gagal", "error"); }
}

async function deleteGoal(id) {
  if(!confirm("Hapus tujuan ini?")) return;
  try {
    await fetch("/api/goals/" + id, { method: "DELETE" });
    await loadGoals();
    renderTujuanPage();
    showToast("Tujuan dihapus");
  } catch(e) { showToast("Gagal", "error"); }
}

function renderTujuanPage() {
  const grid = el("goalGrid");
  grid.innerHTML = "";
  if(goals.length === 0) {
    grid.innerHTML = "<p class='text-gray-500 text-sm col-span-3 text-center py-10'>Belum ada tujuan menabung.</p>";
    return;
  }
  goals.forEach(g => {
    const pct = Math.min(100, Math.round((g.current_amount / g.target_amount) * 100));
    const div = document.createElement("div");
    div.className = "bg-white border border-gray-100 rounded-2xl shadow-card p-6 flex flex-col";
    div.innerHTML = `
      <div class="flex items-start justify-between mb-4">
        <div class="w-12 h-12 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center">
          <i class="${g.icon} text-2xl"></i>
        </div>
        <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-md">
            <i class="ph ph-calendar-blank"></i> <span class="goal-deadline"></span>
            </span>
            <button class="delete-goal-btn text-gray-400 hover:text-red-500"><i class="ph ph-trash"></i></button>
        </div>
      </div>
      <h3 class="font-bold text-gray-900 mb-1 goal-name"></h3>
      <div class="flex items-center justify-between text-sm mb-4">
        <span class="font-bold text-amber-600">${fmtRupiah(g.current_amount)}</span>
        <span class="text-gray-400 text-xs">/ ${fmtRupiah(g.target_amount)}</span>
      </div>
      <div class="w-full bg-gray-100 rounded-full h-2 mb-2">
        <div class="bg-amber-500 h-2 rounded-full" style="width: ${pct}%"></div>
      </div>
      <p class="text-right text-xs text-gray-500 font-medium mb-4">${pct}% terkumpul</p>
      <button class="add-funds-btn mt-auto w-full py-2 bg-amber-50 text-amber-600 hover:bg-amber-100 font-bold text-sm rounded-lg transition-colors">
        + Tambah Dana
      </button>
    `;
    div.querySelector(".goal-name").textContent = g.name;
    div.querySelector(".goal-deadline").textContent = g.deadline;
    div.querySelector(".delete-goal-btn").addEventListener("click", () => deleteGoal(g.id));
    div.querySelector(".add-funds-btn").addEventListener("click", () => addGoalFunds(g.id));
    grid.appendChild(div);
  });
}

// --- Reminder Logic ---
async function saveReminder() {
  const payload = {
    title: el("remTitle").value,
    amount: el("remAmount").value,
    due_date: el("remDate").value
  };
  try {
    const res = await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    await loadReminders();
    renderPengingatPage();
    toggleReminderDrawer();
    showToast("Pengingat disimpan");
  } catch(e) { showToast("Gagal simpan pengingat", "error"); }
}

async function payReminder(id) {
  if(!confirm("Tandai tagihan ini lunas dan catat pengeluaran otomatis?")) return;
  try {
    await fetch("/api/reminders/" + id + "/pay", { method: "POST" });
    await loadData();
    showToast("Tagihan lunas, transaksi dicatat!");
  } catch(e) { showToast("Gagal", "error"); }
}

async function deleteReminder(id) {
  if(!confirm("Hapus pengingat ini?")) return;
  try {
    await fetch("/api/reminders/" + id, { method: "DELETE" });
    await loadReminders();
    renderPengingatPage();
    showToast("Pengingat dihapus");
  } catch(e) { showToast("Gagal", "error"); }
}

function renderPengingatPage() {
  const ul = el("reminderList");
  ul.innerHTML = "";
  if(reminders.length === 0) {
    ul.innerHTML = "<p class='text-gray-500 text-sm p-6 text-center'>Tidak ada tagihan.</p>";
    return;
  }
  reminders.forEach(r => {
    const li = document.createElement("li");
    li.className = "flex items-center justify-between p-4 " + (r.is_paid ? "bg-gray-50 opacity-60" : "hover:bg-gray-50") + " transition-colors";
    li.innerHTML = `
      <div class="flex items-center gap-4">
        <div class="w-10 h-10 rounded-xl ${r.is_paid ? 'bg-gray-200 text-gray-400' : 'bg-rose-50 text-rose-500'} flex items-center justify-center">
          <i class="ph-fill ph-bell text-xl"></i>
        </div>
        <div>
          <p class="font-bold ${r.is_paid ? 'text-gray-500 line-through' : 'text-gray-900'} reminder-title"></p>
          <div class="flex items-center gap-3 mt-0.5 text-xs">
            <span class="font-semibold text-rose-600">${fmtRupiah(r.amount)}</span>
            <span class="text-gray-400">• Jatuh Tempo: <span class="reminder-due"></span></span>
          </div>
        </div>
      </div>
      <div class="flex gap-2 items-center">
          ${r.is_paid ? '<span class="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded">Lunas</span>' : '<button class="pay-reminder-btn text-sm font-semibold text-white bg-rose-500 hover:bg-rose-600 px-4 py-1.5 rounded-lg shadow-sm">Tandai Lunas</button>'}
          <button class="delete-reminder-btn text-gray-400 hover:text-red-500 p-2"><i class="ph ph-trash"></i></button>
      </div>
    `;
    li.querySelector(".reminder-title").textContent = r.title;
    li.querySelector(".reminder-due").textContent = r.due_date;
    if (!r.is_paid) li.querySelector(".pay-reminder-btn").addEventListener("click", () => payReminder(r.id));
    li.querySelector(".delete-reminder-btn").addEventListener("click", () => deleteReminder(r.id));
    ul.appendChild(li);
  });
}

// --- Budget Logic ---
async function setBudget(name) {
  const amt = prompt("Atur limit bulanan (Rp) untuk kategori " + name + ":");
  if (!amt || isNaN(amt)) return;
  const cat = categories.find(c => c.name === name);
  if(!cat) return;
  cat.budget = Number(amt);
  try {
    await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cat),
    });
    await loadCategories();
    renderBudgetPage();
    showToast("Budget diupdate");
  } catch(e) {}
}

function renderBudgetPage() {
  const container = el("fullBudgetList");
  container.innerHTML = "";
  
  const mtx = monthTx();
  const expCats = categories.filter(c => c.type === 'expense');
  
  expCats.forEach(c => {
    const spent = mtx.filter(t => t.category === c.name).reduce((sum, t) => sum + t.amount, 0);
    const limit = c.budget || 0;
    const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
    
    let pctColor = "bg-brand-500";
    if (pct > 75) pctColor = "bg-amber-500";
    if (pct >= 100) pctColor = "bg-red-500";

    const div = document.createElement("div");
    div.className = "pt-4 pb-2";
    div.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl ${c.color_bg} ${c.color_text} flex items-center justify-center">
            <i class="${c.icon} text-lg"></i>
          </div>
          <span class="font-bold text-gray-900 budget-page-cat-name"></span>
        </div>
        <div class="text-right">
          <span class="font-bold text-sm ${pct >= 100 ? 'text-red-500' : 'text-gray-900'}">${fmtRupiah(spent)}</span>
          <span class="text-xs text-gray-400 font-medium">/ ${limit > 0 ? fmtRupiah(limit) : 'Belum diatur'}</span>
          <button class="edit-limit-btn ml-2 text-brand-600 hover:text-brand-800 bg-brand-50 px-2 py-1 rounded transition-colors text-xs font-semibold"><i class="ph-bold ph-pencil-simple"></i> Edit Limit</button>
        </div>
      </div>
      <div class="w-full bg-gray-100 rounded-full h-2.5 mt-3 mb-1 shadow-inner">
        <div class="h-2.5 rounded-full transition-all duration-500 ${pctColor}" style="width: ${pct}%"></div>
      </div>
    `;
    div.querySelector(".budget-page-cat-name").textContent = c.name;
    div.querySelector(".edit-limit-btn").addEventListener("click", () => setBudget(c.name));
    container.appendChild(div);
  });
}

// --- Laporan Logic ---
function renderLaporanPage() {
  if (!summary) return;
  
  const labels = summary.monthlyData.map((d) => monthLabelShort(d.month)).reverse();
  const incData = summary.monthlyData.map((d) => d.income).reverse();
  const expData = summary.monthlyData.map((d) => d.expense).reverse();

  if (laporanCashflowChartInstance) laporanCashflowChartInstance.destroy();
  const ctxCash = el("laporanCashflowChart").getContext("2d");
  laporanCashflowChartInstance = new Chart(ctxCash, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Pemasukan", data: incData, backgroundColor: "#22c55e", borderRadius: 4 },
        { label: "Pengeluaran", data: expData, backgroundColor: "#ef4444", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: { y: { ticks: { callback: (val) => "Rp" + (val/1000).toLocaleString() + "k" } } }
    }
  });

  const mtx = monthTx().filter(t => t.type === "expense");
  const grouped = {};
  mtx.forEach(t => {
    grouped[t.category] = (grouped[t.category] || 0) + t.amount;
  });
  
  const sorted = Object.entries(grouped).sort((a,b) => b[1] - a[1]);
  const catLabels = sorted.map(i => i[0]);
  const catData = sorted.map(i => i[1]);
  const catBg = catLabels.map(cat => getCatColor(cat).hex);

  if (laporanCategoryChartInstance) laporanCategoryChartInstance.destroy();
  const ctxCat = el("laporanCategoryChart").getContext("2d");
  laporanCategoryChartInstance = new Chart(ctxCat, {
    type: "doughnut",
    data: {
      labels: catLabels,
      datasets: [{ data: catData, backgroundColor: catBg, borderWidth: 0, hoverOffset: 4 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      plugins: { legend: { display: false } }
    }
  });
  
  const legendEl = el("laporanCategoryLegend");
  legendEl.innerHTML = "";
  if(sorted.length === 0) {
    legendEl.innerHTML = "<p class='text-gray-400 text-sm italic py-4 text-center'>Belum ada pengeluaran di bulan ini.</p>";
  }
  sorted.forEach(([cat, amount]) => {
    const color = getCatColor(cat);
    const div = document.createElement("div");
    div.className = "flex items-center justify-between text-sm p-2 hover:bg-gray-50 rounded-lg transition-colors";
    div.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="w-3.5 h-3.5 rounded-full shadow-sm" style="background-color: ${color.hex}"></span>
        <span class="text-gray-700 font-medium">${cat}</span>
      </div>
      <span class="font-bold text-gray-900">${fmtRupiah(amount)}</span>
    `;
    legendEl.appendChild(div);
  });
}

// ============================================================
// INIT
// ============================================================
async function loadUser() {
  try {
    const res = await fetch("/api/me");
    if (res.ok) {
      const data = await res.json();
      if (data.loggedIn && data.username) {
        if (el("sidebarUsername")) el("sidebarUsername").textContent = data.username;
        if (el("mobileSidebarUsername")) el("mobileSidebarUsername").textContent = data.username;
        if (el("settingsUsername")) el("settingsUsername").textContent = data.username;
      }
    }
  } catch (e) {}
}

function init() {
  loadUser();
  // Month navigation
  el("prevMonth").addEventListener("click", () => shiftMonth(-1));
  el("nextMonth").addEventListener("click", () => shiftMonth(1));

  // Sidebar navigation
  document.querySelectorAll("#sidebarNav .nav-link, #mobileSidebarNav .nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo(link.dataset.page);
    });
  });

  // Dashboard filter tabs
  document.querySelectorAll(".dash-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      dashFilter = btn.dataset.filter;
      document.querySelectorAll(".dash-filter-btn").forEach((b) => {
        if (b.dataset.filter === dashFilter) {
          b.className = "dash-filter-btn px-3 py-1.5 text-xs font-medium rounded-md bg-brand-600 text-white shadow-sm";
        } else {
          b.className = "dash-filter-btn px-3 py-1.5 text-xs font-medium rounded-md text-gray-600 hover:text-gray-900";
        }
      });
      renderDashTxTable(monthTx());
    });
  });

  // Transaction page filter tabs
  document.querySelectorAll(".tx-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      txFilter = btn.dataset.filter;
      document.querySelectorAll(".tx-filter-btn").forEach((b) => {
        if (b.dataset.filter === txFilter) {
          b.className = "tx-filter-btn px-3 py-1.5 text-xs font-medium rounded-md bg-brand-600 text-white shadow-sm";
        } else {
          b.className = "tx-filter-btn px-3 py-1.5 text-xs font-medium rounded-md text-gray-600 hover:text-gray-900";
        }
      });
      renderTransactionPage();
    });
  });

  // Transaction page search
  el("txSearchInput").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderTransactionPage();
  });

  // Global search (navigates to transaksi page)
  el("globalSearchInput").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    if (currentPage !== "transaksi") {
      navigateTo("transaksi");
    }
    el("txSearchInput").value = e.target.value;
    renderTransactionPage();
  });

  // Export CSV
  el("exportBtn").addEventListener("click", exportCSV);

  // Drawer: type toggle
  document.querySelectorAll('input[name="drawerTxType"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      txType = e.target.value;
      populateCategories();
    });
  });

  // Amount formatting
  el("txAmount").addEventListener("input", (e) => {
    const digitsOnly = e.target.value.replace(/\D/g, "");
    e.target.value = formatAmountInput(digitsOnly);
  });

  // Save transaction
  el("saveTxBtn").addEventListener("click", () => {
    const amount = parseFloat(getRawAmount());
    const category = el("txCategory").value;
    const date = el("txDate").value;
    const note = el("txNote").value.trim();
    const method = el("txMethod").value;
    if (!amount || amount <= 0 || !date) {
      showToast("Isi jumlah dan tanggal dengan benar.", "error");
      return;
    }
    addTransaction({ type: txType, amount, category, note, date, method });
    toggleDrawer();
  });

  // Module Drawers
  el("saveCategoryBtn").addEventListener("click", saveCategory);
  el("saveGoalBtn").addEventListener("click", saveGoal);
  el("saveReminderBtn").addEventListener("click", saveReminder);

  // Settings
  if (el("changePasswordForm")) {
    el("changePasswordForm").addEventListener("submit", handleChangePassword);
  }

  // Logout
  ["logoutBtn", "logoutBtnMobile"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", logout);
  });

  // Populate default categories
  populateCategories();

  // Load data
  loadData();
}

async function logout() {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch (e) {
    // lanjut redirect walau request gagal
  }
  window.location.href = "/login.html";
}

// --- Account Settings ---
async function handleChangePassword(e) {
  e.preventDefault();
  const oldPassword = el("cpOldPassword").value;
  const newPassword = el("cpNewPassword").value;
  const btn = el("changePasswordBtn");
  const errBox = el("changePasswordError");
  const successBox = el("changePasswordSuccess");

  errBox.classList.add("hidden");
  successBox.classList.add("hidden");

  if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    errBox.textContent = "Password baru minimal 8 karakter dan harus mengandung huruf serta angka.";
    errBox.classList.remove("hidden");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Menyimpan...";

  try {
    const res = await fetch("/api/account/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword, newPassword }),
    });

    if (res.ok) {
      successBox.textContent = "Password berhasil diubah!";
      successBox.classList.remove("hidden");
      el("changePasswordForm").reset();
    } else {
      const data = await res.json().catch(() => ({}));
      errBox.textContent = data.error || "Gagal mengubah password.";
      errBox.classList.remove("hidden");
    }
  } catch (err) {
    errBox.textContent = "Tidak bisa terhubung ke server.";
    errBox.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Simpan Password";
  }
}

function showDeleteConfirm() {
  el("deleteAccountSection").classList.add("hidden");
  el("deleteConfirmSection").classList.remove("hidden");
  el("deleteAccountPassword").value = "";
  el("deleteAccountError").classList.add("hidden");
}

function hideDeleteConfirm() {
  el("deleteAccountSection").classList.remove("hidden");
  el("deleteConfirmSection").classList.add("hidden");
  el("deleteAccountPassword").value = "";
  el("deleteAccountError").classList.add("hidden");
}

async function confirmDeleteAccount() {
  const password = el("deleteAccountPassword").value;
  const errorEl = el("deleteAccountError");
  const btn = el("confirmDeleteBtn");

  if (!password) {
    errorEl.textContent = "Password tidak boleh kosong";
    errorEl.classList.remove("hidden");
    return;
  }

  errorEl.classList.add("hidden");
  btn.disabled = true;
  btn.textContent = "Menghapus...";

  try {
    const res = await fetch("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      window.location.href = "/login.html";
    } else {
      const data = await res.json().catch(() => ({}));
      errorEl.textContent = data.error || "Gagal menghapus akun.";
      errorEl.classList.remove("hidden");
    }
  } catch (err) {
    errorEl.textContent = "Tidak bisa terhubung ke server.";
    errorEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Ya, Hapus Permanen";
  }
}

init();
