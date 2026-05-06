// ── shared.js ──────────────────────────────────────────────────────────────
// Global state, Supabase API, utilities, and bottom nav rendering.
// Every page loads this first.

const SUPABASE_URL = "https://gnawprpsbtfgamgojobc.supabase.co";
const SUPABASE_KEY = "sb_publishable_WKJC8Gg6EV3PAQYtpaeIwQ_SmBSjK_l";
const LOW = 2;

let pantries = [];
let currentPantry = null;
let pantry = [];

// ── Supabase REST helper ───────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Prefer": method === "POST" ? "return=representation" : ""
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, opts);
  if (!r.ok) { const e = await r.text(); throw new Error(e); }
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// ── Pantry load / save ─────────────────────────────────────────────────────
async function loadPantries(onReady) {
  setSyncStatus("Loading pantries…");
  try {
    let rows = await api("GET", "pantries?select=id,name,items&order=name");
    pantries = rows || [];
    if (!pantries.length) {
      await api("POST", "pantries", { name: "My Pantry", items: [] });
      pantries = await api("GET", "pantries?select=id,name,items&order=name");
    }
    const saved = localStorage.getItem("pantry_current");
    currentPantry = pantries.find(p => p.name === saved) || pantries[0];
    pantry = currentPantry.items || [];
    setSyncStatus(null);
    if (onReady) onReady();
  } catch (e) {
    setSyncStatus("Could not connect to cloud. Check your internet connection.");
  }
}

async function saveItems() {
  try {
    await api("PATCH", "pantries?id=eq." + currentPantry.id, { items: pantry });
    currentPantry.items = pantry;
  } catch (e) {
    setSyncStatus("Error saving. Check connection.");
  }
}

async function switchPantry(id) {
  const p = pantries.find(p => p.id === id);
  if (!p) return;
  currentPantry = p;
  pantry = p.items || [];
  localStorage.setItem("pantry_current", p.name);
  if (typeof onPantrySwitch === "function") onPantrySwitch();
}

async function addNewPantry() {
  const name = prompt("Name for the new pantry:");
  if (!name || !name.trim()) return;
  const key = name.trim();
  if (pantries.find(p => p.name === key)) { alert("A pantry with that name already exists."); return; }
  setSyncStatus("Creating…");
  try {
    const rows = await api("POST", "pantries", { name: key, items: [] });
    const newP = Array.isArray(rows) ? rows[0] : rows;
    pantries.push(newP);
    pantries.sort((a, b) => a.name.localeCompare(b.name));
    currentPantry = newP;
    pantry = [];
    localStorage.setItem("pantry_current", key);
    setSyncStatus(null);
    if (typeof onPantrySwitch === "function") onPantrySwitch();
  } catch (e) { setSyncStatus("Error creating pantry."); }
}

async function deleteCurrentPantry() {
  if (pantries.length <= 1) { alert("You need at least one pantry."); return; }
  if (!confirm('Delete "' + currentPantry.name + '"? This cannot be undone.')) return;
  setSyncStatus("Deleting…");
  try {
    await api("DELETE", "pantries?id=eq." + currentPantry.id);
    pantries = pantries.filter(p => p.id !== currentPantry.id);
    currentPantry = pantries[0];
    pantry = currentPantry.items || [];
    localStorage.setItem("pantry_current", currentPantry.name);
    setSyncStatus(null);
    if (typeof onPantrySwitch === "function") onPantrySwitch();
  } catch (e) { setSyncStatus("Error deleting pantry."); }
}

// ── Item helpers ───────────────────────────────────────────────────────────
function addOrIncrementItem(name, barcode, image) {
  const clean = cleanProductName(name);
  const existing = pantry.find(i =>
    (barcode && i.barcode === barcode) || i.name.toLowerCase() === clean.toLowerCase()
  );
  if (existing) {
    pantry = pantry.map(i => i.id === existing.id
      ? { ...i, qty: i.qty + 1, image: i.image || image || null }
      : i
    );
  } else {
    pantry.push({ id: Date.now(), name: clean, qty: 1, barcode: barcode || "", image: image || null });
  }
}

function cleanProductName(name) {
  return String(name || "").replace(/\s+/g, " ").replace(/^[,\-\s]+|[,\-\s]+$/g, "").trim();
}

// ── Open Food Facts ────────────────────────────────────────────────────────
async function lookupBarcode(code) {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`);
    const d = await r.json();
    if (d.status === 1 && d.product) {
      const name = cleanProductName(d.product.product_name || d.product.product_name_en || d.product.brands || "");
      const image = d.product.image_front_small_url || d.product.image_front_url || d.product.image_small_url || d.product.image_url || null;
      return { name, image };
    }
  } catch (e) {}
  return null;
}

async function searchOpenFoodFacts(query) {
  try {
    const url = "https://world.openfoodfacts.org/cgi/search.pl?" + new URLSearchParams({
      search_terms: query, search_simple: "1", action: "process", json: "1", page_size: "8"
    });
    const r = await fetch(url);
    const d = await r.json();
    return (d.products || []).filter(p => p.product_name || p.product_name_en || p.brands);
  } catch (e) { return []; }
}

function buildProductSearchQuery(text) {
  const bad = new Set(["nutrition","facts","calories","serving","servings","amount","daily","value","total","fat","sodium","carbohydrate","protein","ingredients","contains","distributed","manufactured","best","before","use","by","net","wt","oz","g","ml","fl","barcode","recycle","keep","refrigerated","natural","artificial","flavor","flavors"]);
  const words = text.replace(/[^a-zA-Z0-9\s&'-]/g, " ").split(/\s+/).map(w => w.trim()).filter(w => w.length > 2 && !bad.has(w.toLowerCase()) && !/^\d+$/.test(w));
  const unique = [];
  for (const w of words) { if (!unique.find(x => x.toLowerCase() === w.toLowerCase())) unique.push(w); }
  return unique.slice(0, 6).join(" ").trim();
}

// ── UI helpers ─────────────────────────────────────────────────────────────
function setSyncStatus(msg) {
  const el = document.getElementById("sync-status");
  if (!el) return;
  if (msg) { el.style.display = "block"; el.textContent = msg; }
  else el.style.display = "none";
}

function showFeedback(msg) {
  const el = document.getElementById("scan-feedback");
  if (!el) return;
  el.style.display = "block"; el.textContent = msg;
  clearTimeout(showFeedback._t);
  showFeedback._t = setTimeout(() => el.style.display = "none", 3000);
}

function renderPantrySelector(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = pantries.map(p =>
    `<option value="${p.id}"${p.id === currentPantry.id ? " selected" : ""}>${escapeHtml(p.name)}</option>`
  ).join("");
}

function itemThumbHtml(item) {
  if (item.image) {
    return `<img class="item-thumb" src="${escapeHtml(item.image)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="item-thumb-placeholder" style="display:none">🥫</div>`;
  }
  return `<div class="item-thumb-placeholder">🥫</div>`;
}

// ── Escape helpers ─────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function escapeJs(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, " ");
}

// ── Bottom nav ─────────────────────────────────────────────────────────────
function renderNav(active) {
  const pages = [
    { href: "index.html",   icon: "🥫", label: "Pantry"  },
    { href: "scanner.html", icon: "▥",  label: "Scan"    },
    { href: "recipes.html", icon: "🍳", label: "Recipes" },
  ];
  const nav = document.getElementById("bottom-nav");
  if (!nav) return;
  nav.innerHTML = pages.map(p =>
    `<a href="${p.href}" class="nav-item${p.href === active ? " active" : ""}">
      <span class="nav-icon">${p.icon}</span>
      <span class="nav-label">${p.label}</span>
    </a>`
  ).join("");
}
