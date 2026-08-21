const express = require("express");
const path = require("path");
const fs = require("fs");
const initSqlJs = require("sql.js");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "kas.db");

// --- VULN-001 FIX: Session secret wajib dari env, atau auto-generate saat dev ---
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("FATAL: SESSION_SECRET wajib diatur di production.");
    console.error("Contoh: SESSION_SECRET=string-acak-32-karakter node server.js");
    process.exit(1);
  }
  SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("[DEV] SESSION_SECRET tidak diatur. Menggunakan secret acak sementara (session akan hilang saat restart).\n");
}

async function main() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  let db;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // --- Schema ---
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      note TEXT DEFAULT '',
      date TEXT NOT NULL,
      method TEXT DEFAULT 'Tunai'
    );
    CREATE TABLE IF NOT EXISTS categories (
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      icon TEXT NOT NULL,
      color_bg TEXT NOT NULL,
      color_text TEXT NOT NULL,
      color_hex TEXT NOT NULL,
      budget REAL DEFAULT 0,
      PRIMARY KEY (user_id, name)
    );
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      target_amount REAL NOT NULL,
      current_amount REAL DEFAULT 0,
      deadline TEXT NOT NULL,
      icon TEXT,
      color TEXT
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      amount REAL NOT NULL,
      due_date TEXT NOT NULL,
      is_paid INTEGER DEFAULT 0
    );
    
    CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);
  `);

  function saveDb() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
  saveDb();

  function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  }

  function queryOne(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    let result = null;
    if (stmt.step()) result = stmt.getAsObject();
    stmt.free();
    return result;
  }

  function seedDefaultCategories(userId) {
    const defaultCategories = [
      [userId, "Makan", "expense", "ph-fill ph-fork-knife", "bg-brand-50", "text-brand-600", "#22c55e", 1200000],
      [userId, "Transport", "expense", "ph-fill ph-bus", "bg-blue-50", "text-blue-500", "#3b82f6", 600000],
      [userId, "Kos/Sewa", "expense", "ph-fill ph-house-line", "bg-indigo-50", "text-indigo-500", "#6366f1", 1500000],
      [userId, "Pulsa/Internet", "expense", "ph-fill ph-wifi-high", "bg-cyan-50", "text-cyan-500", "#06b6d4", 200000],
      [userId, "Hiburan", "expense", "ph-fill ph-game-controller", "bg-purple-50", "text-purple-500", "#a855f7", 600000],
      [userId, "Belanja", "expense", "ph-fill ph-shopping-cart", "bg-pink-50", "text-pink-500", "#ec4899", 500000],
      [userId, "Kesehatan", "expense", "ph-fill ph-first-aid-kit", "bg-red-50", "text-red-500", "#ef4444", 300000],
      [userId, "Uang Saku", "income", "ph-fill ph-hand-coins", "bg-brand-50", "text-brand-600", "#22c55e", 0],
      [userId, "Beasiswa", "income", "ph-fill ph-graduation-cap", "bg-blue-50", "text-blue-500", "#3b82f6", 0],
      [userId, "Kerja Part-time", "income", "ph-fill ph-briefcase", "bg-amber-50", "text-amber-500", "#f59e0b", 0],
      [userId, "Hadiah", "income", "ph-fill ph-gift", "bg-pink-50", "text-pink-500", "#ec4899", 0],
      [userId, "Lainnya", "expense", "ph-fill ph-dots-three-outline", "bg-gray-100", "text-gray-500", "#94a3b8", 0]
    ];
    for (const cat of defaultCategories) {
      db.run("INSERT INTO categories (user_id, name, type, icon, color_bg, color_text, color_hex, budget) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", cat);
    }
  }

  const app = express();

  // --- VULN-008 FIX: Security headers ---
  app.use(helmet({
    contentSecurityPolicy: false, // Tailwind CDN membutuhkan inline script
  }));

  app.use(express.json());
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 hari
        httpOnly: true,
        sameSite: "lax",
      },
    })
  );

  // --- VULN-002 FIX: Rate limiting pada auth endpoints ---
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 10,                   // maks 10 percobaan per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Terlalu banyak percobaan. Coba lagi dalam 15 menit." },
  });

  app.use(express.static(path.join(__dirname, "public"), { index: false }));

  function requireAuth(req, res, next) {
    if (req.session && req.session.userId) return next();
    return res.status(401).json({ error: "Belum login" });
  }

  // --- Auth Endpoints ---
  const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/; // VULN-006 FIX

  app.post("/api/register", authLimiter, async (req, res) => {
    const { username, password } = req.body || {};

    // VULN-006 FIX: Validasi format username
    if (!username || !usernameRegex.test(username)) {
      return res.status(400).json({ error: "Username hanya boleh huruf, angka, dan underscore (3–30 karakter)" });
    }

    // VULN-004 FIX: Kebijakan password lebih kuat
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password minimal 8 karakter" });
    }
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ error: "Password harus mengandung huruf dan angka" });
    }
    
    // VULN-005 FIX: Anti username enumeration (timing-consistent)
    const existing = queryOne("SELECT id FROM users WHERE username = ?", [username]);
    if (existing) {
      await bcrypt.hash("dummy-timing-pad", 10); // Konsistensi waktu respons
      return res.status(400).json({ error: "Pendaftaran gagal. Coba username lain." });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const hash = await bcrypt.hash(password, 10);
    const nowStr = new Date().toISOString();

    db.run("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)", [id, username, hash, nowStr]);
    seedDefaultCategories(id);
    saveDb();

    req.session.userId = id;
    req.session.username = username;
    res.status(201).json({ ok: true });
  });

  app.post("/api/login", authLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username dan password wajib diisi" });

    const user = queryOne("SELECT * FROM users WHERE username = ?", [username]);
    if (!user) return res.status(401).json({ error: "Username atau password salah" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Username atau password salah" });

    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/me", (req, res) => {
    if (req.session && req.session.userId) {
      res.json({ loggedIn: true, username: req.session.username });
    } else {
      res.json({ loggedIn: false });
    }
  });

  app.get(["/", "/index.html"], (req, res) => {
    if (!(req.session && req.session.userId)) return res.redirect("/login.html");
    res.sendFile(path.join(__dirname, "views", "index.html"));
  });

  const publicApiPaths = ["/api/login", "/api/register", "/api/logout", "/api/me", "/api/health"];
  app.use("/api", (req, res, next) => {
    if (publicApiPaths.includes(req.path)) return next();
    return requireAuth(req, res, next);
  });

  // --- API Endpoints ---
  app.get("/api/transactions", (req, res) => {
    const rows = queryAll("SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC", [req.session.userId]);
    res.json(rows);
  });

  app.post("/api/transactions", (req, res) => {
    const { type, amount, category, note, date, method } = req.body || {};
    if (!["income", "expense"].includes(type) || !amount || amount <= 0 || !category || !date) {
      return res.status(400).json({ error: "Data tidak lengkap" });
    }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const safeMethod = method || "Tunai";
    db.run(
      "INSERT INTO transactions (id, user_id, type, amount, category, note, date, method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, req.session.userId, type, Number(amount), category, (note || "").trim(), date, safeMethod]
    );
    saveDb();
    res.status(201).json({ id, type, amount: Number(amount), category, note: note || "", date, method: safeMethod });
  });

  app.delete("/api/transactions/:id", (req, res) => {
    db.run("DELETE FROM transactions WHERE id = ? AND user_id = ?", [req.params.id, req.session.userId]);
    if (db.getRowsModified() === 0) return res.status(404).json({ error: "Tidak ditemukan" });
    saveDb();
    res.json({ ok: true });
  });

  app.get("/api/summary", (req, res) => {
    const month = req.query.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "Parameter 'month' tidak valid" });
    const uid = req.session.userId;

    const [y, m] = month.split("-").map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

    const cur = queryOne("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) AS income, COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense FROM transactions WHERE user_id = ? AND substr(date, 1, 7) = ?", [uid, month]);
    const prev = queryOne("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) AS income, COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense FROM transactions WHERE user_id = ? AND substr(date, 1, 7) = ?", [uid, prevMonth]);
    const bal = queryOne("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0) AS balance FROM transactions WHERE user_id = ?", [uid]);

    const months = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const monthlyData = months.map((mo) => {
      const row = queryOne("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) AS income, COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS expense FROM transactions WHERE user_id = ? AND substr(date, 1, 7) = ?", [uid, mo]);
      return { month: mo, income: row.income, expense: row.expense };
    });

    const balanceByMonth = months.map((mo) => {
      const b = queryOne("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0) AS balance FROM transactions WHERE user_id = ? AND date <= ?", [uid, mo + '-31']);
      return b.balance;
    });

    res.json({ month, income: cur.income, expense: cur.expense, balance: bal.balance, prevIncome: prev.income, prevExpense: prev.expense, prevMonth, monthlyData, balanceByMonth });
  });

  // ================= CATEGORIES =================
  app.get("/api/categories", (req, res) => {
    const rows = queryAll("SELECT * FROM categories WHERE user_id = ? ORDER BY type, name", [req.session.userId]);
    res.json(rows);
  });

  app.post("/api/categories", (req, res) => {
    const { name, type, icon, color_bg, color_text, color_hex, budget } = req.body || {};
    if (!name || !type) return res.status(400).json({ error: "Data tidak lengkap" });
    db.run(
      "INSERT OR REPLACE INTO categories (user_id, name, type, icon, color_bg, color_text, color_hex, budget) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [req.session.userId, name, type, icon || 'ph-fill ph-circles-four', color_bg || 'bg-gray-100', color_text || 'text-gray-500', color_hex || '#94a3b8', Number(budget) || 0]
    );
    saveDb();
    res.status(201).json({ name, type, icon, color_bg, color_text, color_hex, budget });
  });

  app.delete("/api/categories/:name", (req, res) => {
    db.run("DELETE FROM categories WHERE user_id = ? AND name = ?", [req.session.userId, req.params.name]);
    saveDb();
    res.json({ ok: true });
  });

  // ================= GOALS =================
  app.get("/api/goals", (req, res) => {
    res.json(queryAll("SELECT * FROM goals WHERE user_id = ? ORDER BY deadline ASC", [req.session.userId]));
  });

  app.post("/api/goals", (req, res) => {
    const { name, target_amount, deadline, icon, color } = req.body || {};
    if (!name || !target_amount || !deadline) return res.status(400).json({ error: "Data tidak lengkap" });
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    db.run(
      "INSERT INTO goals (id, user_id, name, target_amount, current_amount, deadline, icon, color) VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
      [id, req.session.userId, name, Number(target_amount), deadline, icon || 'ph-target', color || 'bg-blue-500']
    );
    saveDb();
    res.status(201).json({ id, name, target_amount: Number(target_amount), current_amount: 0, deadline, icon, color });
  });

  app.post("/api/goals/:id/add-funds", (req, res) => {
    const { amount } = req.body || {};
    if (!amount || amount <= 0) return res.status(400).json({ error: "Nominal tidak valid" });
    const goal = queryOne("SELECT * FROM goals WHERE id = ? AND user_id = ?", [req.params.id, req.session.userId]);
    if (!goal) return res.status(404).json({ error: "Tujuan tidak ditemukan" });
    const newAmount = goal.current_amount + Number(amount);
    db.run("UPDATE goals SET current_amount = ? WHERE id = ? AND user_id = ?", [newAmount, req.params.id, req.session.userId]);
    
    const txId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    db.run(
      "INSERT INTO transactions (id, user_id, type, amount, category, note, date, method) VALUES (?, ?, 'expense', ?, 'Lainnya', ?, ?, 'Tunai')",
      [txId, req.session.userId, Number(amount), 'Nabung: ' + goal.name, new Date().toISOString().slice(0, 10)]
    );
    saveDb();
    res.json({ ok: true, current_amount: newAmount, transaction_id: txId });
  });

  app.delete("/api/goals/:id", (req, res) => {
    db.run("DELETE FROM goals WHERE id = ? AND user_id = ?", [req.params.id, req.session.userId]);
    saveDb();
    res.json({ ok: true });
  });

  // ================= REMINDERS =================
  app.get("/api/reminders", (req, res) => {
    res.json(queryAll("SELECT * FROM reminders WHERE user_id = ? ORDER BY is_paid ASC, due_date ASC", [req.session.userId]));
  });

  app.post("/api/reminders", (req, res) => {
    const { title, amount, due_date } = req.body || {};
    if (!title || !amount || !due_date) return res.status(400).json({ error: "Data tidak lengkap" });
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    db.run(
      "INSERT INTO reminders (id, user_id, title, amount, due_date, is_paid) VALUES (?, ?, ?, ?, ?, 0)",
      [id, req.session.userId, title, Number(amount), due_date]
    );
    saveDb();
    res.status(201).json({ id, title, amount: Number(amount), due_date, is_paid: 0 });
  });

  app.post("/api/reminders/:id/pay", (req, res) => {
    const reminder = queryOne("SELECT * FROM reminders WHERE id = ? AND user_id = ?", [req.params.id, req.session.userId]);
    if (!reminder) return res.status(404).json({ error: "Pengingat tidak ditemukan" });
    if (reminder.is_paid) return res.status(400).json({ error: "Sudah dibayar" });

    db.run("UPDATE reminders SET is_paid = 1 WHERE id = ? AND user_id = ?", [req.params.id, req.session.userId]);
    const txId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    db.run(
      "INSERT INTO transactions (id, user_id, type, amount, category, note, date, method) VALUES (?, ?, 'expense', ?, 'Lainnya', ?, ?, 'Tunai')",
      [txId, req.session.userId, reminder.amount, 'Bayar Tagihan: ' + reminder.title, new Date().toISOString().slice(0, 10)]
    );
    saveDb();
    res.json({ ok: true, transaction_id: txId });
  });

  app.delete("/api/reminders/:id", (req, res) => {
    db.run("DELETE FROM reminders WHERE id = ? AND user_id = ?", [req.params.id, req.session.userId]);
    saveDb();
    res.json({ ok: true });
  });
  // ================= ACCOUNT =================
  app.put("/api/account/password", requireAuth, async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) return res.status(400).json({ error: "Data tidak lengkap" });
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: "Password baru minimal 8 karakter dan harus mengandung huruf serta angka." });
    }

    const user = queryOne("SELECT * FROM users WHERE id = ?", [req.session.userId]);
    if (!user) return res.status(404).json({ error: "Akun tidak ditemukan" });

    const valid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Password lama salah" });

    const hash = await bcrypt.hash(newPassword, 10);
    db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.session.userId]);
    saveDb();
    res.json({ ok: true });
  });

  app.delete("/api/account", async (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: "Password wajib diisi untuk konfirmasi" });

    const user = queryOne("SELECT * FROM users WHERE id = ?", [req.session.userId]);
    if (!user) return res.status(404).json({ error: "Akun tidak ditemukan" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Password salah" });

    // Hapus semua data milik user
    db.run("DELETE FROM transactions WHERE user_id = ?", [req.session.userId]);
    db.run("DELETE FROM categories WHERE user_id = ?", [req.session.userId]);
    db.run("DELETE FROM goals WHERE user_id = ?", [req.session.userId]);
    db.run("DELETE FROM reminders WHERE user_id = ?", [req.session.userId]);
    db.run("DELETE FROM users WHERE id = ?", [req.session.userId]);
    saveDb();

    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`SisaBerapa? jalan di port ${PORT}, data di ${DATA_DIR}`);
  });
}

main().catch((err) => {
  console.error("Gagal memulai server:", err);
  process.exit(1);
});
