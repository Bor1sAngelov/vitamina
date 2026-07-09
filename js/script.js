/* =========================================================
   ВИТАМИНА — Салатен бар, Враца — общ JavaScript файл
   ========================================================= */

/* ================= КОЛИЧКА (localStorage) ================= */
const CART_KEY = "vitamina_cart_v1";

function getCart(){
  try{ return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch(e){ return []; }
}
function saveCart(cart){
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  renderCartBadge();
}
function cartCount(){ return getCart().reduce((s,l)=> s + l.qty, 0); }
function cartTotal(){ return getCart().reduce((s,l)=> s + l.price*l.qty, 0); }

function askForItemNote(){
  return new Promise((resolve)=>{
    const overlay = document.createElement("div");
    overlay.className = "note-modal-overlay";
    overlay.innerHTML = `
      <div class="note-modal">
        <h3>Бележка към продукта</h3>
        <p>По желание — напр. „без лук“, „добави сирене“, „замени доматите с краставица“.</p>
        <textarea id="noteModalInput" rows="3" placeholder="Твоята бележка тук..."></textarea>
        <div class="note-modal-actions">
          <button type="button" class="btn btn-ghost" id="noteModalSkip">Без бележка</button>
          <button type="button" class="btn btn-primary" id="noteModalSave">Добави бележката</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector("#noteModalInput");
    requestAnimationFrame(()=> input.focus());

    function close(value){
      overlay.classList.add("closing");
      setTimeout(()=> overlay.remove(), 150);
      resolve(value);
    }
    overlay.querySelector("#noteModalSkip").addEventListener("click", ()=> close(""));
    overlay.querySelector("#noteModalSave").addEventListener("click", ()=> close(input.value.trim()));
    overlay.addEventListener("click", (e)=>{ if(e.target === overlay) close(""); });
    input.addEventListener("keydown", (e)=>{
      if(e.key === "Enter" && (e.metaKey || e.ctrlKey)) close(input.value.trim());
      if(e.key === "Escape") close("");
    });
  });
}
function addToCart(item){
  const cart = getCart();
  if(item.id){
    const existing = cart.find(l=> l.id === item.id && !l.details && (l.note||"") === (item.note||""));
    if(existing){ existing.qty += 1; saveCart(cart); return; }
  }
  cart.push({
    cartId: "c" + Date.now() + Math.floor(Math.random()*1000),
    id: item.id || null,
    name: item.name,
    price: item.price,
    details: item.details || "",
    nut: item.nut || null,
    note: item.note || "",
    minNote: item.minNote || "",
    qty: 1,
  });
  saveCart(cart);
}
function removeFromCart(cartId){ saveCart(getCart().filter(l=> l.cartId !== cartId)); }
function changeQty(cartId, delta){
  const cart = getCart();
  const line = cart.find(l=> l.cartId === cartId);
  if(!line) return;
  line.qty += delta;
  if(line.qty <= 0){ saveCart(cart.filter(l=> l.cartId !== cartId)); return; }
  saveCart(cart);
}
function clearCart(){ saveCart([]); }

function renderCartBadge(){
  document.querySelectorAll("[data-cart-badge]").forEach(el=>{
    const count = cartCount();
    el.textContent = count;
    el.classList.toggle("hidden", count === 0);
  });
}

/* ================= СПОДЕЛЕНА БАЗА (Supabase) — поръчки на живо между всички устройства =================
   Ако SUPABASE_URL и SUPABASE_ANON_KEY са попълнени, поръчките се синхронизират
   между телефона на клиента и компютъра на екипа. Ако не са, сайтът работи по стария начин —
   само в рамките на един браузър/устройство.
*/
let supabaseReady = false;
let supabaseClient = null;
let ordersSubscription = null;
let settingsSubscription = null;
let soupScheduleSubscription = null;
let applicationsSubscription = null;

function initSupabaseSync(){
  if(typeof supabase === "undefined" && typeof Supabase === "undefined") return;
  if(typeof SUPABASE_URL === "undefined" || typeof SUPABASE_ANON_KEY === "undefined" || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try{
    const supabaseNamespace = (typeof supabase !== "undefined" && typeof supabase.createClient === "function") ? supabase
      : (typeof Supabase !== "undefined" && typeof Supabase.createClient === "function") ? Supabase
      : null;
    if(!supabaseNamespace) throw new Error("Supabase SDK не е зареден");
    supabaseClient = supabaseNamespace.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    supabaseReady = true;
    loadOrdersFromSupabase();
    attachSupabaseOrdersListener(()=>{});
    attachOrderingPausedListener(()=>{});
    getSoupScheduleFromSupabase().then(schedule=>{
      if(schedule) localStorage.setItem(SOUP_SCHEDULE_KEY, JSON.stringify(schedule));
    });
    attachSoupScheduleListener(()=>{});
    loadApplicationsFromSupabase();
    attachSupabaseApplicationsListener(()=>{});
  }catch(err){
    console.warn("Supabase не се инициализира:", err);
    supabaseReady = false;
    supabaseClient = null;
  }
}

async function loadOrdersFromSupabase(onChange){
  if(!supabaseReady || !supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("orders")
    .select("*")
    .order("date", { ascending: false });
  if(error){ console.warn("Не може да зареди поръчките от Supabase:", error); return; }
  const orders = (data || []).map(o => ({ ...o, total: Number(o.total) }));
  saveOrders(orders);
  if(typeof onChange === "function") onChange();
}

async function pushOrderToVitaminaSystem(order){
  if(!supabaseReady || !supabaseClient) return false;
  try{
    const { error } = await supabaseClient
      .from("orders")
      .insert([{ ...order }]);
    if(error){ console.warn("Поръчката не се качи в споделената база:", error); return false; }
    return true;
  }catch(err){
    console.warn("Поръчката не се качи в споделената база:", err);
    return false;
  }
}

async function mirrorOrderUpdate(order){
  if(!supabaseReady || !supabaseClient || !order) return;
  await supabaseClient
    .from("orders")
    .upsert([{ ...order }], { onConflict: ["id"] });
}

async function mirrorOrderDelete(id){
  if(!supabaseReady || !supabaseClient || !id) return;
  await supabaseClient
    .from("orders")
    .delete()
    .eq("id", id);
}

async function mirrorOrdersClear(){
  if(!supabaseReady || !supabaseClient) return;
  await supabaseClient
    .from("orders")
    .delete();
}

function attachSupabaseOrdersListener(onChange){
  if(!supabaseReady || !supabaseClient || ordersSubscription) return;
  ordersSubscription = supabaseClient
    .channel("orders_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async () => {
      await loadOrdersFromSupabase(onChange);
    })
    .subscribe();
}

async function saveWeeklySoupSchedule(schedule){
  localStorage.setItem(SOUP_SCHEDULE_KEY, JSON.stringify(schedule));
  if(!supabaseReady || !supabaseClient) return;
  const { error } = await supabaseClient
    .from("settings")
    .upsert([{ key: "soupSchedule", value: schedule }], { onConflict: ["key"] });
  if(error) console.warn("Не може да запази менюто със супите в Supabase:", error);
}
async function getSoupScheduleFromSupabase(){
  if(!supabaseReady || !supabaseClient) return null;
  const { data, error } = await supabaseClient
    .from("settings")
    .select("value")
    .eq("key", "soupSchedule")
    .single();
  if(error || !data) return null;
  return data.value || null;
}
function attachSoupScheduleListener(onChange){
  if(!supabaseReady || !supabaseClient || soupScheduleSubscription) return;
  soupScheduleSubscription = supabaseClient
    .channel("soup_schedule_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, async () => {
      const schedule = await getSoupScheduleFromSupabase();
      if(schedule){
        localStorage.setItem(SOUP_SCHEDULE_KEY, JSON.stringify(schedule));
        if(typeof onChange === "function") onChange(schedule);
      }
    })
    .subscribe();
}

function isOrderingPausedByAdmin(){
  try{ return JSON.parse(localStorage.getItem(ORDERING_PAUSED_KEY))?.paused === true; }
  catch(e){ return false; }
}
function setOrderingPaused(paused){
  localStorage.setItem(ORDERING_PAUSED_KEY, JSON.stringify({ paused, updatedAt: Date.now() }));
  if(!supabaseReady || !supabaseClient) return;
  supabaseClient
    .from("settings")
    .upsert([{ key: "orderingPaused", value: { paused } }], { onConflict: ["key"] })
    .then(({ error }) => {
      if(error) console.warn("Не може да запази статуса на поръчките в Supabase:", error);
    });
}
function attachOrderingPausedListener(onChange){
  if(!supabaseReady || !supabaseClient || settingsSubscription) return;
  settingsSubscription = supabaseClient
    .channel("settings_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, async () => {
      const paused = await getOrderingPausedFromSupabase();
      localStorage.setItem(ORDERING_PAUSED_KEY, JSON.stringify({ paused, updatedAt: Date.now() }));
      if(typeof onChange === "function") onChange(paused);
    })
    .subscribe();
}

async function getOrderingPausedFromSupabase(){
  if(!supabaseReady || !supabaseClient) return false;
  const { data, error } = await supabaseClient
    .from("settings")
    .select("value")
    .eq("key", "orderingPaused")
    .single();
  if(error) return false;
  return data?.value?.paused === true;
}
function showOrderingPausedOverlay(){
  if(document.querySelector(".pause-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "pause-overlay";
  overlay.innerHTML = `
    <div class="pause-overlay-card">
      <button type="button" class="pause-overlay-close" aria-label="Затвори">✕</button>
      <div class="pause-overlay-icon">🕒</div>
      <p>${escapeHtml(ORDERING_PAUSED_MESSAGE)}</p>
    </div>
  `;
  document.body.appendChild(overlay);
  function close(){ overlay.classList.add("closing"); setTimeout(()=> overlay.remove(), 150); }
  overlay.querySelector(".pause-overlay-close").addEventListener("click", close);
  overlay.addEventListener("click", (e)=>{ if(e.target === overlay) close(); });
}


const ORDERS_KEY = "vitamina_orders_v1";
function getOrders(){
  try{ return JSON.parse(localStorage.getItem(ORDERS_KEY)) || []; }
  catch(e){ return []; }
}
function saveOrders(orders){ localStorage.setItem(ORDERS_KEY, JSON.stringify(orders)); }
function nextOrderNumber(){
  const orders = getOrders();
  return orders.reduce((max,o)=>Math.max(max, o.number||0), 100) + 1;
}
function createOrder({ name, phone, time, note }){
  const cart = getCart();
  const order = {
    id: "ord_" + Date.now(),
    number: nextOrderNumber(),
    date: new Date().toISOString(),
    name, phone, time: time || "", note: note || "",
    items: cart.map(l=>({ name:l.name, details:l.details, qty:l.qty, price:l.price, note:l.note||"", minNote:l.minNote||"" })),
    total: cartTotal(),
    status: "new",
    confirmStatus: "pending",
    delayMinutes: null,
  };
  const orders = getOrders();
  orders.unshift(order);
  saveOrders(orders);
  return order;
}
function updateOrderStatus(id, status){
  const orders = getOrders();
  const o = orders.find(x=>x.id===id);
  if(o){ o.status = status; saveOrders(orders); mirrorOrderUpdate(o); }
}
function confirmOrder(id){
  const orders = getOrders();
  const o = orders.find(x=>x.id===id);
  if(o){ o.confirmStatus = "confirmed"; o.delayMinutes = null; saveOrders(orders); mirrorOrderUpdate(o); }
  return o;
}
function delayOrder(id, minutes){
  const orders = getOrders();
  const o = orders.find(x=>x.id===id);
  if(o){ o.confirmStatus = "delayed"; o.delayMinutes = minutes; saveOrders(orders); mirrorOrderUpdate(o); }
  return o;
}
function deleteOrder(id){ saveOrders(getOrders().filter(o=>o.id!==id)); mirrorOrderDelete(id); }
function clearAllOrders(){ saveOrders([]); mirrorOrdersClear(); }


/* ---- звуков сигнал за нова поръчка (админ панел) ---- */
function playOrderChime(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i)=>{
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i*0.18);
      gain.gain.exponentialRampToValueAtTime(0.3, now + i*0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i*0.18 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i*0.18);
      osc.stop(now + i*0.18 + 0.2);
    });
  }catch(e){ /* тих провал, ако браузърът блокира звука преди клик */ }
}

/* ---- SMS съобщение до клиента при потвърждение/отлагане на поръчка ---- */
function isMobileDevice(){
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function showSmsFallbackModal(phone, text){
  const overlay = document.createElement("div");
  overlay.className = "note-modal-overlay";
  overlay.innerHTML = `
    <div class="note-modal">
      <h3>📋 Съобщение за клиента</h3>
      <p>На компютър не можем да изпратим SMS директно — копирай текста и го изпрати ръчно по Viber, WhatsApp или обаждане на <b>${escapeHtml(phone)}</b>.</p>
      <textarea id="smsFallbackText" rows="4" readonly>${text}</textarea>
      <div class="note-modal-actions">
        <button type="button" class="btn btn-ghost" id="smsFallbackClose">Затвори</button>
        <button type="button" class="btn btn-primary" id="smsFallbackCopy">Копирай текста</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const textarea = overlay.querySelector("#smsFallbackText");
  requestAnimationFrame(()=> textarea.select());
  function close(){ overlay.classList.add("closing"); setTimeout(()=> overlay.remove(), 150); }
  overlay.querySelector("#smsFallbackClose").addEventListener("click", close);
  overlay.querySelector("#smsFallbackCopy").addEventListener("click", ()=>{
    textarea.select();
    try{ navigator.clipboard && navigator.clipboard.writeText(text); }catch(e){}
    showToast("Текстът е копиран 📋");
  });
  overlay.addEventListener("click", (e)=>{ if(e.target === overlay) close(); });
}
function sendOrderSms(phone, text){
  const cleanPhone = String(phone||"").replace(/[^\d+]/g, "");
  try{ navigator.clipboard && navigator.clipboard.writeText(text); }catch(e){}
  if(isMobileDevice()){
    const smsLink = `sms:${cleanPhone}?&body=${encodeURIComponent(text)}`;
    window.location.href = smsLink;
  } else {
    showSmsFallbackModal(cleanPhone, text);
  }
}
function buildConfirmSmsText(o){
  return `Здравей, ${o.name}! Поръчка №${o.number} във Витамина е потвърдена${o.time ? " за " + o.time + " ч." : ""}. Очакваме те! 🌿`;
}
function buildDelaySmsText(o, minutes){
  return `Здравей, ${o.name}! Поръчка №${o.number} във Витамина ще бъде готова след около ${minutes} мин.${o.time ? " (вместо заявения час " + o.time + " ч.)" : ""}. Благодарим за търпението! 🌿`;
}

/* ================= КАНДИДАТУРИ ЗА РАБОТА (за админ панела) ================= */
const APPS_KEY = "vitamina_applications_v1";
function getApplications(){
  try{ return JSON.parse(localStorage.getItem(APPS_KEY)) || []; }
  catch(e){ return []; }
}
function saveApplications(apps){ localStorage.setItem(APPS_KEY, JSON.stringify(apps)); }
function createApplication({ name, phone, email, position, experience, message, photoName, photoData, cvName, cvData }){
  const app = {
    id: "app_" + Date.now(),
    date: new Date().toISOString(),
    name, phone, email, position, experience: experience || "", message: message || "",
    photoName: photoName || "", photoData: photoData || "",
    cvName: cvName || "", cvData: cvData || "",
    status: "new",
  };
  const apps = getApplications();
  apps.unshift(app);
  saveApplications(apps);
  pushApplicationToSupabase(app);
  return app;
}
function updateApplicationStatus(id, status){
  const apps = getApplications();
  const a = apps.find(x=>x.id===id);
  if(a){ a.status = status; saveApplications(apps); mirrorApplicationUpdate(a); }
}
function deleteApplication(id){ saveApplications(getApplications().filter(a=>a.id!==id)); mirrorApplicationDelete(id); }
function clearAllApplications(){ saveApplications([]); mirrorApplicationsClear(); }

async function pushApplicationToSupabase(app){
  if(!supabaseReady || !supabaseClient) return;
  try{
    const { error } = await supabaseClient.from("applications").insert([{ ...app }]);
    if(error) console.warn("Кандидатурата не се качи в споделената база:", error);
  }catch(err){
    console.warn("Кандидатурата не се качи в споделената база:", err);
  }
}
async function mirrorApplicationUpdate(app){
  if(!supabaseReady || !supabaseClient || !app) return;
  await supabaseClient.from("applications").upsert([{ ...app }], { onConflict: ["id"] });
}
async function mirrorApplicationDelete(id){
  if(!supabaseReady || !supabaseClient || !id) return;
  await supabaseClient.from("applications").delete().eq("id", id);
}
async function mirrorApplicationsClear(){
  if(!supabaseReady || !supabaseClient) return;
  await supabaseClient.from("applications").delete().neq("id", "");
}
async function loadApplicationsFromSupabase(onChange){
  if(!supabaseReady || !supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("applications")
    .select("*")
    .order("date", { ascending: false });
  if(error){ console.warn("Не може да зареди кандидатурите от Supabase:", error); return; }
  saveApplications(data || []);
  if(typeof onChange === "function") onChange();
}
function attachSupabaseApplicationsListener(onChange){
  if(!supabaseReady || !supabaseClient || applicationsSubscription) return;
  applicationsSubscription = supabaseClient
    .channel("applications_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, async () => {
      await loadApplicationsFromSupabase(onChange);
    })
    .subscribe();
}

function formatDate(iso){
  const d = new Date(iso);
  return d.toLocaleDateString("bg-BG") + " " + d.toLocaleTimeString("bg-BG", { hour:"2-digit", minute:"2-digit" });
}
function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

/* ================= ТЕЛЕФОНЕН НОМЕР — валидация =================
   Позволени символи: само цифри 0-9 и знакът "+" (единствено в
   самото начало, като част от кода "+359"). Номерът се приема само
   когато съдържа точно 10 цифри, като "+359" се брои за 1 цифра
   (замества водещата национална "0"), напр.:
     0888123456      -> 10 цифри -> валиден
     +359888123456   -> "+359"(=1) + 888123456(9) = 10 -> валиден
*/
function sanitizePhoneChars(value){
  const original = String(value == null ? "" : value);
  const hadLeadingPlus = original.trim().startsWith("+");
  let digitsOnly = original.replace(/[^0-9]/g, "");
  return hadLeadingPlus ? "+" + digitsOnly : digitsOnly;
}
function countPhoneDigits(value){
  const v = String(value == null ? "" : value).trim();
  if(v.startsWith("+359")) return 1 + v.slice(4).length;
  return v.replace(/\+/g, "").length;
}
function isValidPhoneNumber(value){
  const v = String(value == null ? "" : value).trim();
  if(!v) return false;
  if(!/^\+?[0-9]+$/.test(v)) return false;
  if(v.startsWith("+") && !v.startsWith("+359")) return false;
  return countPhoneDigits(v) === 10;
}
/* Прикачва към поле за телефон: (1) чисти всеки символ, който не е
   цифра или водещо "+", докато се пише, и (2) визуално отбелязва
   полето като невалидно, докато номерът не отговаря на изискването
   за 10 цифри (виж isValidPhoneNumber). */
function attachPhoneInputGuard(input){
  if(!input) return;
  input.setAttribute("inputmode", "tel");
  const markValidity = ()=>{
    const ok = isValidPhoneNumber(input.value);
    input.classList.toggle("field-invalid", input.value.trim().length > 0 && !ok);
  };
  input.addEventListener("input", ()=>{
    const cleaned = sanitizePhoneChars(input.value);
    if(cleaned !== input.value) input.value = cleaned;
    markValidity();
  });
  input.addEventListener("blur", markValidity);
}

/* =========================================================
   БРОЯЧ НА ПОСЕТИТЕЛИ (само за админ панела)
   Тих брояч — не се показва никъде пред посетителите на сайта.
   Понеже сайтът е чисто front-end (без собствен сървър/база данни),
   за да се събират посещения от ВСИЧКИ устройства на едно място (не
   само от браузъра на който отваряш admin.html), се ползва безплатната
   услуга CountAPI (countapi.xyz) — публично API, без нужда от ключ,
   което просто пази едно число в облака и го връща/увеличава при
   всяко повикване. Ако услугата е недостъпна (напр. блокирана от
   adblock/VPN), пада на локален резервен брояч, важащ само за
   текущия браузър — панелът показва ясно кой от двата вижда.
   ========================================================= */
const VISIT_NAMESPACE = "vitamina-vratsa-site"; // сменете, ако искате да рестартирате статистиката
const VISIT_KEY_TOTAL = "pageviews";
const VISIT_KEY_UNIQUE = "unique-visitors";
const VISIT_LOCAL_TOTAL_KEY = "vitamina_visits_local_total_v1";
const VISIT_LOCAL_UNIQUE_KEY = "vitamina_visits_local_unique_v1";
const VISITOR_SEEN_KEY = "vitamina_visitor_seen_v1";
const VISITOR_ID_KEY = "vitamina_visitor_id_v1";

/* Случайно id, пазено в localStorage — идентифицира този браузър
   (не човек), за да можем да броим уникални прегледи по страница
   в Supabase таблицата page_views (виж viewer.html). */
function getVisitorId(){
  let id = localStorage.getItem(VISITOR_ID_KEY);
  if(!id){
    id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("v" + Date.now() + Math.random().toString(16).slice(2));
    localStorage.setItem(VISITOR_ID_KEY, id);
  }
  return id;
}
/* Име на текущата страница (без .html), напр. "index", "menu",
   "cart" — ползва се като стойност на колоната "page" в page_views. */
function getCurrentPageName(){
  const file = window.location.pathname.split("/").pop();
  return (file ? file.replace(/\.html$/i, "") : "") || "index";
}
async function recordPageViewToSupabase(page){
  if(!supabaseReady || !supabaseClient) return;
  try{
    await supabaseClient.from("page_views").insert([{ page, visitor_id: getVisitorId() }]);
  }catch(err){
    console.warn("Не може да запише преглед на страницата в Supabase:", err);
  }
}

function bumpLocalCounter(key){
  const n = (parseInt(localStorage.getItem(key) || "0", 10) || 0) + 1;
  localStorage.setItem(key, String(n));
  return n;
}
async function countapiHit(key){
  try{
    const res = await fetch(`https://api.countapi.xyz/hit/${VISIT_NAMESPACE}/${key}`);
    if(!res.ok) throw new Error("countapi unavailable");
    const data = await res.json();
    return data.value;
  }catch(e){ return null; }
}
async function countapiGet(key){
  try{
    const res = await fetch(`https://api.countapi.xyz/get/${VISIT_NAMESPACE}/${key}`);
    if(!res.ok) throw new Error("countapi unavailable");
    const data = await res.json();
    return data.value;
  }catch(e){ return null; }
}

/* Извиква се веднъж на всяко зареждане на публична страница
   (не и в admin.html/viewer.html, за да не се броят собствените
   прегледи на екипа). */
async function trackVisit(){
  bumpLocalCounter(VISIT_LOCAL_TOTAL_KEY);
  await countapiHit(VISIT_KEY_TOTAL);
  recordPageViewToSupabase(getCurrentPageName());
  if(!localStorage.getItem(VISITOR_SEEN_KEY)){
    localStorage.setItem(VISITOR_SEEN_KEY, "1");
    bumpLocalCounter(VISIT_LOCAL_UNIQUE_KEY);
    await countapiHit(VISIT_KEY_UNIQUE);
  }
}

/* Ползва се само в admin.html, за да покаже статистиката. */
async function getVisitStats(){
  const [total, unique] = await Promise.all([countapiGet(VISIT_KEY_TOTAL), countapiGet(VISIT_KEY_UNIQUE)]);
  const cloudWorks = total !== null && unique !== null;
  return {
    total: cloudWorks ? total : (parseInt(localStorage.getItem(VISIT_LOCAL_TOTAL_KEY)||"0",10)),
    unique: cloudWorks ? unique : (parseInt(localStorage.getItem(VISIT_LOCAL_UNIQUE_KEY)||"0",10)),
    cloudWorks,
  };
}

/* ================= TOAST ================= */
function showToast(msg){
  let toast = document.querySelector(".toast");
  if(!toast){
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> toast.classList.remove("show"), 2600);
}

/* ================= SCROLL REVEAL ================= */
function initReveal(){
  const targets = document.querySelectorAll(".reveal, .reveal-stagger");
  if(!targets.length) return;
  /* Прагът е нарочно много нисък (не зависи от височината на елемента):
     при дълги списъци (напр. категория с много продукти, като „Салати“)
     старият праг от 0.14 изискваше твърде голяма видима част от целия
     (много висок) контейнер, за да се задейства — практически никога не
     се достигаше и продуктите оставаха невидими (opacity:0). */
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){ e.target.classList.add("in-view"); io.unobserve(e.target); }
    });
  }, { threshold:0.01, rootMargin:"0px 0px -40px 0px" });
  targets.forEach(t=> io.observe(t));
}

/* ================= AMBIENT LEAF FIELD ================= */
function initLeafField(){
  const field = document.querySelector(".leaf-field");
  if(!field) return;
  const leaves = ["🥬","🍅","🥕","🥑","🌿","🫐"];
  for(let i=0;i<10;i++){
    const el = document.createElement("span");
    el.className = "leaf-drift";
    el.textContent = leaves[i % leaves.length];
    el.style.left = (Math.random()*94 + 2) + "%";
    el.style.animationDelay = (Math.random()*14) + "s";
    el.style.animationDuration = (10 + Math.random()*8) + "s";
    el.style.fontSize = (1.1 + Math.random()*1.2) + "rem";
    field.appendChild(el);
  }
}

/* ================= NAV (общ за всички страници) ================= */
function initNav(){
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if(toggle && links){
    toggle.addEventListener("click", ()=> links.classList.toggle("open"));
    links.querySelectorAll("a").forEach(a=> a.addEventListener("click", ()=> links.classList.remove("open")));
  }
  const path = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach(a=>{
    if(a.getAttribute("href") === path) a.classList.add("active");
  });
  document.querySelectorAll("#year, .current-year").forEach(el=> el.textContent = new Date().getFullYear());
  document.querySelectorAll("[data-contact-phone]").forEach(el=> el.textContent = CONTACT_INFO.phone);
  document.querySelectorAll("[data-contact-phone-href]").forEach(el=> el.href = `tel:${CONTACT_INFO.phoneHref}`);
  document.querySelectorAll("[data-contact-address]").forEach(el=> el.textContent = CONTACT_INFO.address);
  document.querySelectorAll("[data-contact-hours]").forEach(el=> el.textContent = CONTACT_INFO.hours);
  document.querySelectorAll("[data-contact-hours-full]").forEach(el=>{
    el.innerHTML = "<ul class='hours-list'>" + formatWorkingHoursSchedule().map(line=>`<li>${line}</li>`).join("") + "</ul>";
  });
  document.querySelectorAll("[data-contact-facebook]").forEach(el=> el.href = CONTACT_INFO.facebook);
  document.querySelectorAll("[data-contact-instagram]").forEach(el=> el.href = CONTACT_INFO.instagram);
  document.querySelectorAll("[data-contact-tiktok]").forEach(el=> el.href = CONTACT_INFO.tiktok);
  renderCartBadge();
}

/* ================= HOME PAGE ================= */
function initHome(){
  const soupCard = document.getElementById("soupCard");
  if(soupCard){
    const soups = getTodaysSoups();
    soupCard.innerHTML = `
      <div class="stamp floaty">
        <span class="stamp-eyebrow">Днес</span>
        <span class="stamp-word">Супа</span>
        <span class="stamp-word">на деня</span>
        <span class="stamp-date">${getTodayDateString()}</span>
      </div>
      <div>
        ${soups.map(s => `
          <div class="soup-of-day-item">
            ${s.photo ? `<img src="${s.photo}" alt="${escapeHtml(s.name)}" class="soup-of-day-photo">` : ""}
            <h3>${escapeHtml(s.name)}</h3>
          </div>
        `).join("")}
        <div class="soup-of-day-item">
          <h3>Таратор</h3>
          <p class="soup-tarator-note">${fmt(TARATOR_PRICE)} € — по желание с ядки (+${fmt(TARATOR_NUTS_ADDON_PRICE)} €)</p>
        </div>
      </div>
      <a href="menu.html" class="btn btn-primary">Поръчай сега</a>
    `;
  }

  const galleryStrip = document.getElementById("galleryStrip");
  if(galleryStrip){
    const photos = [
      "img/gallery/gallery1.jpg",
      "img/gallery/gallery2.jpg",
      "img/gallery/gallery3.jpg",
      "img/gallery/gallery4.jpg",
      "img/gallery/gallery5.jpg",
      "img/gallery/gallery6.jpg",
    ];
    galleryStrip.innerHTML = photos.map(src => `
      <img src="${src}" alt="Момент от кухнята на Витамина" class="gallery-photo">
    `).join("");
  }
}

/* =========================================================
   КАЛКУЛАТОР НА КАЛОРИИ И МАКРОНУТРИЕНТИ
   ========================================================= */
function initNutritionCalculator(mountId){
  const mount = document.getElementById(mountId);
  if(!mount) return;

  const allItems = MENU_DATA.flatMap(cat => cat.category === "Супи"
    ? buildTodaysSoupMenuItems().map(it => ({...it, category:cat.category}))
    : cat.items.map(it => {
        if(it.sizes){
          const def = it.sizes.find(s=>s.isDefault) || it.sizes[0];
          return {...it, category:cat.category, price:def.price, nut:def.nut, weight:def.label};
        }
        return {...it, category:cat.category};
      }));
  const picked = {};

  mount.innerHTML = `
    <div class="calc-wrap">
      <div class="calc-picker">
        <label for="calcSelect">Добави продукт от менюто</label>
        <select id="calcSelect" class="dressing-select">
          ${MENU_DATA.map(cat => `<optgroup label="${cat.category}">${allItems.filter(it=>it.category===cat.category).map(it=>`<option value="${it.id}">${it.name}</option>`).join("")}</optgroup>`).join("")}
        </select>
        <button id="calcAddBtn" class="btn btn-secondary btn-sm" style="margin-top:12px;">+ Добави към калкулатора</button>
        <div id="calcPickedList" class="calc-picked-list"></div>
      </div>
      <div class="calc-results">
        <h4>Общо хранителни стойности</h4>
        <div class="calc-stat"><span>Калории</span><b id="calcKcal">0</b><small>kcal</small></div>
        <div class="calc-stat"><span>Протеини</span><b id="calcP">0</b><small>г</small></div>
        <div class="calc-stat"><span>Въглехидрати</span><b id="calcC">0</b><small>г</small></div>
        <div class="calc-stat"><span>Мазнини</span><b id="calcF">0</b><small>г</small></div>
        <p class="calc-note">Стойностите са ориентировъчни оценки на база съставките.</p>
        <button id="calcResetBtn" class="btn btn-ghost btn-sm">Изчисти</button>
      </div>
    </div>
  `;

  const select = mount.querySelector("#calcSelect");
  const addBtn = mount.querySelector("#calcAddBtn");
  const resetBtn = mount.querySelector("#calcResetBtn");
  const listEl = mount.querySelector("#calcPickedList");

  function render(){
    const ids = Object.keys(picked);
    if(ids.length === 0){
      listEl.innerHTML = `<div class="bowl-empty">Все още нищо не е добавено.</div>`;
    } else {
      listEl.innerHTML = ids.map(id=>{
        const item = allItems.find(i=>i.id===id);
        const qty = picked[id];
        return `<div class="calc-line" data-id="${id}">
          <span>${escapeHtml(item.name)} × ${qty}${item.nutNote ? ` <em class="calc-nutnote">(${escapeHtml(item.nutNote)})</em>` : ""}</span>
          <span class="calc-line-actions">
            <button data-act="minus" aria-label="Намали">−</button>
            <button data-act="plus" aria-label="Увеличи">+</button>
            <button data-act="del" aria-label="Премахни">✕</button>
          </span>
        </div>`;
      }).join("");
    }
    let kcal=0,p=0,c=0,f=0;
    ids.forEach(id=>{
      const item = allItems.find(i=>i.id===id);
      const qty = picked[id];
      if(item && item.nut){ kcal += item.nut.kcal*qty; p += item.nut.p*qty; c += item.nut.c*qty; f += item.nut.f*qty; }
    });
    mount.querySelector("#calcKcal").textContent = Math.round(kcal);
    mount.querySelector("#calcP").textContent = Math.round(p);
    mount.querySelector("#calcC").textContent = Math.round(c);
    mount.querySelector("#calcF").textContent = Math.round(f);
  }

  addBtn.addEventListener("click", ()=>{
    const id = select.value;
    picked[id] = (picked[id] || 0) + 1;
    render();
  });
  resetBtn.addEventListener("click", ()=>{
    Object.keys(picked).forEach(k=> delete picked[k]);
    render();
  });
  listEl.addEventListener("click", (e)=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    const row = e.target.closest(".calc-line");
    const id = row.dataset.id;
    if(btn.dataset.act === "plus") picked[id] += 1;
    if(btn.dataset.act === "minus"){ picked[id] -= 1; if(picked[id] <= 0) delete picked[id]; }
    if(btn.dataset.act === "del") delete picked[id];
    render();
  });

  render();
}

/* ================= MENU PAGE ================= */
let selectedMenuItem = null;
/* Кой грамаж е избран във всеки момент за продукти с item.smallSize
   (напр. салатите) — id -> "large" | "small". По подразбиране "large". */
const menuChosenSize = {};

/* За продукт с item.smallSize връща ефективните стойности (цена,
   грамаж, калории) спрямо избрания в момента размер. За малкия размер
   калориите умишлено НЕ се връщат (не са известни за по-малкия грамаж). */
function getEffectiveItemView(item){
  if(item.sizes){
    let idx = menuChosenSize[item.id];
    if(idx === undefined || idx === null || !item.sizes[idx]){
      idx = item.sizes.findIndex(s=>s.isDefault);
      if(idx < 0) idx = 0;
    }
    const s = item.sizes[idx];
    return { size: idx, weight: s.label, price: s.price, nut: s.nut || null, nameSuffix: ` (${s.label})` };
  }
  const size = menuChosenSize[item.id] || "large";
  if(size === "small" && item.smallSize){
    return { size, weight:item.smallSize.weight, price:item.smallSize.price, nut:null, nameSuffix:` (${item.smallSize.weight})` };
  }
  return { size:"large", weight:item.weight, price:item.price, nut:item.nut, nameSuffix:"" };
}

function renderDetailPanel(item){
  const panel = document.getElementById("detailPanel");
  if(!panel) return;
  if(!item){
    panel.innerHTML = `
      <div class="detail-empty-logo"><img src="logo-vitamina.png" alt="Витамина" class="detail-logo-img"></div>
      <h3>Избери продукт</h3>
      <p class="sub">Докосни артикул от менюто, за да видиш повече детайли тук.</p>
      <div class="detail-empty">Няма избран продукт</div>
    `;
    return;
  }
  const view = getEffectiveItemView(item);
  panel.innerHTML = `
    ${item.photo ? `<img src="${item.photo}" class="menu-item-photo" alt="${escapeHtml(item.name)}">` : `<div class="img-placeholder ph-card"><span class="ph-icon">📷</span><span class="ph-label">Снимка предстои</span></div>`}
    <h3>${escapeHtml(item.name)}</h3>
    ${item.desc ? `<p class="sub">${escapeHtml(item.desc)}</p>` : ""}
    ${item.sizes ? `
      <div class="size-toggle" data-size-toggle="${item.id}">
        ${item.sizes.map((s,i)=>`<button type="button" class="size-btn ${view.size===i?'active':''}" data-size="${i}">${escapeHtml(s.label)}</button>`).join("")}
      </div>
    ` : item.smallSize ? `
      <div class="size-toggle" data-size-toggle="${item.id}">
        <button type="button" class="size-btn ${view.size==='large'?'active':''}" data-size="large">${escapeHtml(item.weight)}</button>
        <button type="button" class="size-btn ${view.size==='small'?'active':''}" data-size="small">${escapeHtml(item.smallSize.weight)}</button>
      </div>
    ` : (item.weight ? `<span class="dp-weight">${escapeHtml(item.weight)}</span>` : "")}
    ${view.nut
      ? `<p class="sub" style="margin-top:10px;">≈ ${view.nut.kcal} kcal · Б ${view.nut.p} г · В ${view.nut.c} г · М ${view.nut.f} г${item.nutNote ? ` <em>(${escapeHtml(item.nutNote)})</em>` : ""}</p>`
      : (item.smallSize && view.size === "small" ? `<p class="sub" style="margin-top:10px; opacity:.7; font-style:italic;">Калориите за по-малкия грамаж не са известни.</p>` : "")}
    ${item.isTarator ? `<label class="tarator-nuts-toggle"><input type="checkbox" data-tarator-nuts-detail> Добави ядки (+${fmt(TARATOR_NUTS_ADDON_PRICE)} €)</label>` : ""}
    <div class="dp-price">${fmt(view.price)} €</div>
    <button class="btn btn-primary btn-block" style="margin-top:16px;" data-add-detail="${item.id}">Добави в количката</button>
  `;
  if(item.sizes || item.smallSize){
    panel.querySelectorAll("[data-size]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        menuChosenSize[item.id] = item.sizes ? parseInt(btn.dataset.size, 10) : btn.dataset.size;
        renderDetailPanel(item);
        syncMenuGridCardSize(item.id);
      });
    });
  }
  panel.querySelector("[data-add-detail]").addEventListener("click", async ()=>{
    const note = await askForItemNote();
    const v = getEffectiveItemView(item);
    let price = v.price;
    let nameSuffix = v.nameSuffix;
    if(item.isTarator){
      const cb = panel.querySelector("[data-tarator-nuts-detail]");
      if(cb && cb.checked){ price += TARATOR_NUTS_ADDON_PRICE; nameSuffix += " с ядки"; }
    }
    const sizeTag = item.sizes ? `-size${v.size}` : (v.size === "small" ? "-small" : "");
    const cartId = item.id + sizeTag + (item.isTarator && nameSuffix.includes("ядки") ? "-nuts" : "");
    addToCart({ id:cartId, name:item.name + nameSuffix, price, nut:v.nut, note });
    showToast(`${item.name}${nameSuffix} е добавена в количката 🛒`);
  });
}

/* Генерира продуктите за категория "Супи": днешните супи (от
   getTodaysSoups(), редактируеми в админ панела) плюс таратора, който
   е наличен всеки ден. Резултатът се показва в менюто досущ като
   обикновени продукти, но не идва от MENU_DATA. */
function buildTodaysSoupMenuItems(){
  const soups = getTodaysSoups().map((s, i) => ({
    id: "soup-today-" + i,
    name: s.name,
    price: SOUP_PRICE,
    weight: "300 мл.",
    desc: "",
    photo: s.photo || "",
    nut: { kcal:190, p:4, c:22, f:8 },
  }));
  const tarator = {
    id: "tarator-today",
    name: "Таратор",
    price: TARATOR_PRICE,
    weight: "300 мл.",
    desc: "",
    nut: { kcal:120, p:5, c:8, f:7 },
    isTarator: true,
  };
  return [...soups, tarator];
}

function initMenu(){
  const menuGrid = document.getElementById("menuGrid");
  const tabsWrap = document.getElementById("menuTabs");
  if(!menuGrid || !tabsWrap) return;

  initNutritionCalculator("calcWidget");

  let activeIdx = 1; // старт директно на "Салати"
  if(location.hash === "#menuTabs"){ activeIdx = -1; } // дошли сме от бутон "Направи си сам"
  let currentCategoryItems = []; // текущо показваните продукти (статични или динамични, напр. супите за деня)

  function renderTabs(){
    tabsWrap.innerHTML = MENU_DATA.map((cat,i)=> cat.category === "Дресинги" ? "" : `<button class="menu-tab ${activeIdx===i?'active':''}" data-idx="${i}">${cat.category}</button>`).join("") +
      `<button class="menu-tab menu-tab-diy ${activeIdx===-1?'active':''}" data-idx="-1">Направи си сам</button>`;
  }

  function renderItems(){
    const gridWrap = document.getElementById("menuGridWrap");
    const builderTypeCards = document.getElementById("builderTypeCards");
    const builderMount = document.getElementById("builderMount");

    if(activeIdx === -1){
      if(gridWrap) gridWrap.style.display = "none";
      if(builderTypeCards) builderTypeCards.style.display = "grid";
      renderBuilderTabs();
      return;
    }
    if(gridWrap) gridWrap.style.display = "grid";
    if(builderTypeCards) builderTypeCards.style.display = "none";
    if(builderMount) builderMount.innerHTML = "";

    const cat = MENU_DATA[activeIdx];
    const isSoupCategory = cat.category === "Супи";
    const items = isSoupCategory ? buildTodaysSoupMenuItems() : cat.items;
    currentCategoryItems = items;
    menuGrid.className = "menu-grid reveal-stagger";
    menuGrid.innerHTML = items.map(item => {
      const view = getEffectiveItemView(item);
      return `
      <div class="menu-item" data-id="${item.id}">
        ${item.photo ? `<img src="${item.photo}" class="menu-item-photo" alt="${escapeHtml(item.name)}">` : `<div class="img-placeholder ph-card"><span class="ph-icon">📷</span><span class="ph-label">Снимка предстои</span></div>`}
        <div class="menu-item-top">
          <h4>${escapeHtml(item.name)}</h4>
          <span class="price" data-price>${fmt(view.price)} €</span>
        </div>
        ${item.desc ? `<p class="desc">${escapeHtml(item.desc)}</p>` : ""}
        ${item.sizes ? `
          <div class="size-toggle" data-size-toggle="${item.id}">
            ${item.sizes.map((s,i)=>`<button type="button" class="size-btn ${view.size===i?'active':''}" data-size="${i}">${escapeHtml(s.label)}</button>`).join("")}
          </div>
        ` : item.smallSize ? `
          <div class="size-toggle" data-size-toggle="${item.id}">
            <button type="button" class="size-btn ${view.size==='large'?'active':''}" data-size="large">${escapeHtml(item.weight)}</button>
            <button type="button" class="size-btn ${view.size==='small'?'active':''}" data-size="small">${escapeHtml(item.smallSize.weight)}</button>
          </div>
        ` : (item.weight ? `<span class="weight-pill">${escapeHtml(item.weight)}</span>` : "")}
        ${item.isTarator ? `<label class="tarator-nuts-toggle"><input type="checkbox" data-tarator-nuts> Добави ядки (+${fmt(TARATOR_NUTS_ADDON_PRICE)} €)</label>` : ""}
        <button class="btn btn-secondary btn-sm btn-block" data-add="${item.id}" style="margin-top:12px;">+ Добави в количката</button>
      </div>
    `;
    }).join("");

    menuGrid.querySelectorAll("[data-size-toggle]").forEach(toggle=>{
      toggle.addEventListener("click", (e)=>{
        e.stopPropagation();
        const btn = e.target.closest("[data-size]");
        if(!btn) return;
        const id = toggle.dataset.sizeToggle;
        const item = currentCategoryItems.find(i=>i.id===id);
        menuChosenSize[id] = item && item.sizes ? parseInt(btn.dataset.size, 10) : btn.dataset.size;
        syncMenuGridCardSize(id);
        if(selectedMenuItem === id){
          renderDetailPanel(item);
        }
      });
    });

    menuGrid.querySelectorAll(".menu-item").forEach(el=>{
      el.addEventListener("click", (e)=>{
        if(e.target.closest("[data-add]") || e.target.closest("[data-size-toggle]")) return;
        const id = el.dataset.id;
        const item = currentCategoryItems.find(i=>i.id===id);
        menuGrid.querySelectorAll(".menu-item").forEach(x=>x.classList.remove("selected"));
        if(selectedMenuItem === id){
          selectedMenuItem = null;
          renderDetailPanel(null);
        } else {
          selectedMenuItem = id;
          el.classList.add("selected");
          renderDetailPanel(item);
        }
      });
    });
    menuGrid.querySelectorAll("[data-add]").forEach(btn=>{
      btn.addEventListener("click", async (e)=>{
        e.stopPropagation();
        const id = btn.dataset.add;
        const item = currentCategoryItems.find(i=>i.id===id);
        const note = await askForItemNote();
        const v = getEffectiveItemView(item);
        let price = v.price;
        let nameSuffix = v.nameSuffix;
        if(item.isTarator){
          const card = btn.closest(".menu-item");
          const nutsChecked = card && card.querySelector("[data-tarator-nuts]") && card.querySelector("[data-tarator-nuts]").checked;
          if(nutsChecked){ price += TARATOR_NUTS_ADDON_PRICE; nameSuffix += " с ядки"; }
        }
        const sizeTag = item.sizes ? `-size${v.size}` : (v.size === "small" ? "-small" : "");
        const cartId = item.id + sizeTag + (item.isTarator && nameSuffix.includes("ядки") ? "-nuts" : "");
        addToCart({ id:cartId, name:item.name + nameSuffix, price, nut:v.nut, note });
        showToast(`${item.name}${nameSuffix} е добавена в количката 🛒`);
        selectedMenuItem = id;
        menuGrid.querySelectorAll(".menu-item").forEach(x=>x.classList.toggle("selected", x.dataset.id === id));
        renderDetailPanel(item);
      });
    });
    renderDetailPanel(null);
    initReveal();
  }

  /* Обновява само цената и активния бутон за грамаж на конкретна
     карта в грида на менюто, без пълен ре-рендер (запазва скрола). */
  function syncMenuGridCardSize(id){
    const card = menuGrid.querySelector(`.menu-item[data-id="${id}"]`);
    if(!card) return;
    const item = currentCategoryItems.find(i=>i.id===id);
    if(!item) return;
    const view = getEffectiveItemView(item);
    const priceEl = card.querySelector("[data-price]");
    if(priceEl) priceEl.textContent = fmt(view.price) + " €";
    card.querySelectorAll("[data-size]").forEach(b=>{
      b.classList.toggle("active", String(b.dataset.size) === String(view.size));
    });
  }

  function renderBuilderTabs(){
    menuGrid.className = "";
    menuGrid.innerHTML = "";
    const wrap = document.getElementById("builderTypeCards");
    wrap.innerHTML = Object.entries(BUILDERS).map(([key,b])=>`
      <div class="diy-type-card ${key==='salad' ? 'active':''}" data-type="${key}">
        <span class="diy-name">${b.label}</span>
      </div>
    `).join("");
    wrap.querySelectorAll(".diy-type-card").forEach(card=>{
      card.addEventListener("click", ()=>{
        wrap.querySelectorAll(".diy-type-card").forEach(c=>c.classList.remove("active"));
        card.classList.add("active");
        renderBuilder(card.dataset.type);
      });
    });
    renderBuilder("salad");
  }

  function renderBuilder(type){
    const builder = BUILDERS[type];
    const mount = document.getElementById("builderMount");
    const selected = {}; // id -> qty
    if(Array.isArray(builder.defaultSelected)){
      builder.defaultSelected.forEach(id=>{ selected[id] = (selected[id]||0) + 1; });
    }
    let selectedDressing = builder.hasDressing ? builder.dressings[builder.dressings.length ? 0 : 0].id : null;

    function selectedCount(){ return Object.values(selected).reduce((s,q)=>s+q,0); }
    /* Връща общата сума в ЕВРО. Всяка единична цена (съставка/дресинг)
       се закръгля до евроцент ПРЕДИ да се умножи по количество (виж
       unitEUR в data.js) — иначе сборуването в лева и закръгляне чак
       накрая кара показаната цена да "скача" с ±1 цент при 3-та/4-та
       добавена бройка от една и съща съставка. */
    function selectedTotal(){
      let total = 0;
      Object.entries(selected).forEach(([id,qty])=>{
        const ing = builder.ingredients.find(i=>i.id===id);
        if(ing) total += unitEUR(ing.price) * qty;
      });
      if(builder.hasDressing && selectedDressing){
        const d = builder.dressings.find(x=>x.id===selectedDressing);
        if(d) total += unitEUR(d.price);
      }
      return Math.round(total * 100) / 100;
    }
    /* Цената тръгва от 0 € и расте само с добавените съставки — НЕ се
       „вдига“ изкуствено до минимума. Минималната стойност само блокира
       добавянето в количката, докато изборът не я достигне (виж isBelowMin).
       selectedTotal() вече връща директно евро, затова тук няма нужда
       от toEUR(). */
    function isBelowMin(){ return selectedTotal() < (builder.minPrice || 0) - 0.005; }
    function selectedNutrition(){
      let kcal=0, p=0, c=0, f=0;
      Object.entries(selected).forEach(([id,qty])=>{
        const ing = builder.ingredients.find(i=>i.id===id);
        if(ing && ing.nut){ kcal += ing.nut.kcal*qty; p += ing.nut.p*qty; c += ing.nut.c*qty; f += ing.nut.f*qty; }
      });
      if(builder.hasDressing && selectedDressing){
        const d = builder.dressings.find(x=>x.id===selectedDressing);
        if(d && d.nut){ kcal += d.nut.kcal; p += d.nut.p; c += d.nut.c; f += d.nut.f; }
      }
      return { kcal, p, c, f };
    }

    function renderGroups(){
      mount.innerHTML = `
        <div class="builder-wrap">
          <div>
            <p style="color:var(--charcoal-soft); margin-bottom:24px;">${builder.intro}</p>
            <div class="builder-step">
              <h4><span class="num">1</span>Избери съставки</h4>
              <div class="ingredient-grid" id="ingGrid">
                ${builder.ingredients.map(ing=>`
                  <div class="ingredient ${selected[ing.id] ? 'active':''}" data-id="${ing.id}">
                    <div class="name">${escapeHtml(ing.name)}</div>
                    <div class="meta">${ing.price>0 ? fmt(ing.price)+" €" : "включено"}</div>
                    <span class="ing-qty" style="${selected[ing.id]>1 ? '' : 'display:none;'}">${selected[ing.id]>1 ? `×${selected[ing.id]}` : ""}</span>
                  </div>
                `).join("")}
              </div>
            </div>
            ${builder.hasDressing ? `
            <div class="builder-step">
              <h4><span class="num">2</span>Избери ${builder.dressingLabel || "дресинг"}</h4>
              <select id="dressingSelect" class="dressing-select">
                ${builder.dressings.map(d=>`<option value="${d.id}">${d.name}${d.price>0 ? ` (+${fmt(d.price)} €)` : ""}</option>`).join("")}
              </select>
            </div>` : ""}
          </div>
          <div class="bowl-summary">
            <h3>Твоята поръчка</h3>
            <p class="sub">${builder.label}</p>
            <div class="bowl-count" id="bowlCount">Избрани: 0 съставки</div>
            <div class="bowl-line-list" id="bowlLines"><div class="bowl-empty">Все още нищо не е избрано.</div></div>
            <div class="bowl-total"><span>Общо</span><b id="bowlTotal">0.00 €</b></div>
            <p class="calc-note" id="bowlMinNote" style="display:none;"></p>
            <div class="bowl-nutrition" id="bowlNutrition">
              <h4>Хранителни стойности</h4>
              <div class="calc-stat"><span>Калории</span><b id="bowlKcal">0</b><small>kcal</small></div>
              <div class="calc-stat"><span>Протеини</span><b id="bowlP">0</b><small>г</small></div>
              <div class="calc-stat"><span>Въглехидрати</span><b id="bowlC">0</b><small>г</small></div>
              <div class="calc-stat"><span>Мазнини</span><b id="bowlF">0</b><small>г</small></div>
              <p class="calc-note">Стойностите са ориентировъчни оценки на база съставките.</p>
            </div>
            <div class="bowl-actions">
              <button class="btn btn-primary btn-block" id="bowlAddBtn" disabled>${builder.finishLabel}</button>
              <button class="btn btn-ghost btn-block" id="bowlResetBtn">Изчисти избора</button>
            </div>
          </div>
        </div>
      `;

      const ingGrid = mount.querySelector("#ingGrid");
      const dressingSelect = mount.querySelector("#dressingSelect");
      const bowlCount = mount.querySelector("#bowlCount");
      const bowlLines = mount.querySelector("#bowlLines");
      const bowlTotal = mount.querySelector("#bowlTotal");
      const addBtn = mount.querySelector("#bowlAddBtn");
      const resetBtn = mount.querySelector("#bowlResetBtn");

      if(dressingSelect){
        dressingSelect.value = selectedDressing;
        dressingSelect.addEventListener("change", ()=>{ selectedDressing = dressingSelect.value; renderSummary(); });
      }

      /* Обновява визуалното състояние (активен + баджче ×N) на карта
         на съставка според текущото ѝ количество в `selected`. */
      function syncIngredientCard(id){
        const card = ingGrid.querySelector(`.ingredient[data-id="${id}"]`);
        if(!card) return;
        const qty = selected[id] || 0;
        card.classList.toggle("active", qty > 0);
        card.classList.toggle("maxed", qty >= MAX_INGREDIENT_QTY);
        const qtyEl = card.querySelector(".ing-qty");
        if(qtyEl){
          if(qty > 1){ qtyEl.textContent = `×${qty}`; qtyEl.style.display = "inline-block"; }
          else { qtyEl.style.display = "none"; }
        }
      }

      /* Всяко кликване добавя съставката ощe веднъж (двойно кликване =
         добавена два пъти); премахването става с минусчето до реда ѝ
         в „Твоята поръчка“ (виж bowlLines по-долу). */
      ingGrid.addEventListener("click", (e)=>{
        const card = e.target.closest(".ingredient");
        if(!card) return;
        const id = card.dataset.id;
        const current = selected[id] || 0;
        if(current >= MAX_INGREDIENT_QTY){
          const ing = builder.ingredients.find(i=>i.id===id);
          showToast(`Максимум ${MAX_INGREDIENT_QTY} бр. от „${ing ? ing.name : "тази съставка"}“.`);
          return;
        }
        selected[id] = current + 1;
        syncIngredientCard(id);
        renderSummary();
      });

      /* Минусче до всеки ред в „Твоята поръчка“ — маха по 1 бройка,
         за да коригираш грешно кликване. */
      bowlLines.addEventListener("click", (e)=>{
        const btn = e.target.closest("[data-minus]");
        if(!btn) return;
        const id = btn.dataset.minus;
        if(selected[id]){
          selected[id] -= 1;
          if(selected[id] <= 0) delete selected[id];
        }
        syncIngredientCard(id);
        renderSummary();
      });

      addBtn.addEventListener("click", async ()=>{
        const count = selectedCount();
        if(count < 1){
          showToast(`Избери поне 1 съставка.`);
          return;
        }
        if(isBelowMin()){
          showToast(`Минималната стойност за ${builder.label.split(" —")[0].toLowerCase()} е ${builder.minPrice.toFixed(2)} € — добави още съставки (сега имаш ${selectedTotal().toFixed(2)} €).`);
          return;
        }
        const names = Object.keys(selected).map(id => builder.ingredients.find(i=>i.id===id).name);
        let details = names.join(", ");
        if(builder.hasDressing && selectedDressing){
          const d = builder.dressings.find(x=>x.id===selectedDressing);
          if(d && d.id !== "no-dressing") details += ` · ${builder.dressingLabel || "дресинг"}: ${d.name}`;
        }
        const note = await askForItemNote();
        addToCart({ name: builder.label, price: selectedTotal() * EUR_RATE, details, nut: selectedNutrition(), note });
        showToast(`${builder.label} е добавена в количката 🛒`);
        Object.keys(selected).forEach(k=>delete selected[k]);
        renderGroups();
      });

      resetBtn.addEventListener("click", ()=>{
        Object.keys(selected).forEach(k=>delete selected[k]);
        renderGroups();
      });

      function renderSummary(){
        const count = selectedCount();
        bowlCount.textContent = `Избрани: ${count} съставки`;
        const ids = Object.keys(selected);
        if(ids.length === 0){
          bowlLines.innerHTML = `<div class="bowl-empty">Все още нищо не е избрано.</div>`;
        } else {
          bowlLines.innerHTML = ids.map(id=>{
            const ing = builder.ingredients.find(i=>i.id===id);
            const qty = selected[id];
            const unitPrice = unitEUR(ing.price);
            const lineTotal = Math.round(unitPrice * qty * 100) / 100;
            return `<div class="bowl-line">
              <span>${escapeHtml(ing.name)}${qty>1 ? ` × ${qty}` : ""}</span>
              <span class="bowl-line-right">
                <span>${lineTotal>0 ? lineTotal.toFixed(2)+" €" : "вкл."}</span>
                <button type="button" class="bowl-line-minus" data-minus="${id}" title="Премахни едно" aria-label="Премахни едно">−</button>
              </span>
            </div>`;
          }).join("");
        }
        bowlTotal.textContent = selectedTotal().toFixed(2) + " €";
        const minNoteEl = mount.querySelector("#bowlMinNote");
        if(isBelowMin()){
          minNoteEl.style.display = "block";
          const missing = builder.minPrice - selectedTotal();
          minNoteEl.textContent = `Минималната стойност за ${builder.label.split(" —")[0].toLowerCase()} е ${builder.minPrice.toFixed(2)} € — добави още ${missing.toFixed(2)} €, за да продължиш.`;
        } else {
          minNoteEl.style.display = "none";
        }
        const nutrition = selectedNutrition();
        mount.querySelector("#bowlKcal").textContent = Math.round(nutrition.kcal);
        mount.querySelector("#bowlP").textContent = Math.round(nutrition.p);
        mount.querySelector("#bowlC").textContent = Math.round(nutrition.c);
        mount.querySelector("#bowlF").textContent = Math.round(nutrition.f);
        addBtn.disabled = count < 1 || isBelowMin();
      }
      renderSummary();
    }

    renderGroups();
  }

  tabsWrap.addEventListener("click", (e)=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    activeIdx = parseInt(btn.dataset.idx, 10);
    renderTabs();
    renderItems();
  });

  renderTabs();
  renderItems();
}

/* ================= CART / ORDER PAGE ================= */
function initCart(){
  if(!document.getElementById("cartList")) return; // не сме на страницата с количката

  if(isOrderingPausedByAdmin()) showOrderingPausedOverlay();
  attachOrderingPausedListener((paused)=>{ if(paused) showOrderingPausedOverlay(); });

  const banner = document.getElementById("dailyBanner");
  if(banner){
    const soups = getTodaysSoups();
    banner.innerHTML = `
      <div class="stamp floaty">
        <span class="stamp-eyebrow">Днес е</span>
        <span class="stamp-word">${getTodayName()}</span>
        <span class="stamp-date">${getTodayDateString()}</span>
      </div>
      <div class="daily-banner-text">
        <h3>Супа${soups.length>1?"и":""} на деня: ${soups.map(s=>escapeHtml(s.name)).join(" · ")}</h3>
        <h3 style="margin-top:6px;">Таратор: ${fmt(TARATOR_PRICE)} € — по желание с ядки (+${fmt(TARATOR_NUTS_ADDON_PRICE)} €)</h3>
        <p style="margin-top:10px;">Разгледай <a href="menu.html" style="text-decoration:underline;">цялото меню</a> за всички салати, купи, бургери и напитки.</p>
      </div>
    `;
  }

  const cartList = document.getElementById("cartList");
  const cartEmpty = document.getElementById("cartEmpty");
  const cartTotalEl = document.getElementById("cartTotal");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const clearBtn = document.getElementById("clearCartBtn");
  const timeInput = document.getElementById("time");
  const closedNotice = document.getElementById("orderingClosedNotice");
  const closedText = document.getElementById("orderingClosedText");
  const msgBtn = document.getElementById("messengerOrderBtn");
  if(!cartList) return;

  function applyOrderingWindow(){
    const now = new Date();
    const open = isOrderingOpenNow(now);

    if(timeInput){
      const previouslySelected = timeInput.value;
      const slots = getAvailablePickupSlots(now);
      const placeholder = `<option value="" disabled${previouslySelected ? "" : " selected"}>Избери час</option>`;
      timeInput.innerHTML = placeholder + slots.map(t => `<option value="${t}">${t} ч.</option>`).join("");
      // Пазим избрания час, ако все още е валиден (напр. при опресняване на 30 сек.)
      if(previouslySelected && slots.includes(previouslySelected)){
        timeInput.value = previouslySelected;
      }
      timeInput.disabled = slots.length === 0;
    }

    if(closedNotice){
      if(open){
        closedNotice.classList.add("hidden");
      } else {
        closedNotice.classList.remove("hidden");
        if(closedText) closedText.textContent = getOrderingStatusMessage(now);
      }
    }

    if(msgBtn) msgBtn.disabled = !open;
    return open;
  }

  applyOrderingWindow();
  // Опресняваме проверката периодично, за да засечем момента на затваряне/отваряне,
  // без да е нужно да презареждаш страницата.
  setInterval(()=>{ applyOrderingWindow(); renderCart(); }, 30000);

  function renderCart(){
    const cart = getCart();
    if(cart.length === 0){
      cartList.innerHTML = "";
      cartEmpty.classList.remove("hidden");
    } else {
      cartEmpty.classList.add("hidden");
      cartList.innerHTML = cart.map(line => `
        <div class="cart-line" data-cart-id="${line.cartId}">
          <div class="cart-line-info">
            <h4>${escapeHtml(line.name)}</h4>
            ${line.details ? `<p class="cart-line-details">${escapeHtml(line.details)}</p>` : ""}
            ${line.nut ? `<p class="cart-line-nut">≈ ${Math.round(line.nut.kcal)} kcal · Б ${Math.round(line.nut.p)} г · В ${Math.round(line.nut.c)} г · М ${Math.round(line.nut.f)} г</p>` : ""}
            ${line.note ? `<p class="cart-line-note">📝 Бележка: ${escapeHtml(line.note)}</p>` : ""}
            ${line.minNote ? `<p class="cart-line-minnote">ℹ️ ${escapeHtml(line.minNote)}</p>` : ""}
            <span class="cart-line-price">${fmt(line.price)} €</span>
          </div>
          <div class="cart-line-qty">
            <button data-act="minus" aria-label="Намали">−</button>
            <span>${line.qty}</span>
            <button data-act="plus" aria-label="Увеличи">+</button>
          </div>
          <button class="cart-line-remove" data-act="del" aria-label="Премахни">✕</button>
        </div>
      `).join("");
    }
    cartTotalEl.textContent = fmt(cartTotal());
    if(checkoutBtn) checkoutBtn.disabled = cart.length === 0 || !isOrderingOpenNow();
  }

  cartList.addEventListener("click", e=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    const row = e.target.closest(".cart-line");
    const cartId = row.dataset.cartId;
    if(btn.dataset.act === "plus") changeQty(cartId, 1);
    if(btn.dataset.act === "minus") changeQty(cartId, -1);
    if(btn.dataset.act === "del") removeFromCart(cartId);
    renderCart();
  });

  if(clearBtn) clearBtn.addEventListener("click", ()=>{ clearCart(); renderCart(); });

  const form = document.getElementById("orderForm");
  const phoneInput = document.getElementById("phone");
  attachPhoneInputGuard(phoneInput);
  if(form){
    form.addEventListener("submit", async (e)=>{
      e.preventDefault();
      if(isOrderingPausedByAdmin()){
        showOrderingPausedOverlay();
        return;
      }
      const data = new FormData(form);
      const name = (data.get("name") || "").trim();
      const phone = (data.get("phone") || "").trim();
      const time = data.get("time") || "";
      const note = data.get("note") || "";

      if(!name || !phone || !time){
        showToast("Моля, попълни име, телефон и час за вземане, за да можеш да поръчаш.");
        return;
      }
      if(!isValidPhoneNumber(phone)){
        showToast("Моля, въведи валиден телефонен номер — точно 10 цифри (напр. 0888123456 или +359888123456).");
        if(phoneInput) phoneInput.focus();
        return;
      }

      const cart = getCart();
      if(cart.length === 0){ showToast("Количката е празна — добави продукти от менюто."); return; }
      if(!isOrderingOpenNow()){
        applyOrderingWindow();
        showToast(getOrderingStatusMessage());
        return;
      }

      const order = createOrder({ name, phone, time, note });
      const pushed = await pushOrderToVitaminaSystem(order);

      clearCart();
      renderCart();
      if(pushed){
        showToast(`Поръчка #${order.number} е изпратена успешно.`);
      } else {
        showToast(`Поръчка #${order.number} е записана локално, но не се качи в споделената система — обади ни се, за да сме сигурни, че сме я видели: ${CONTACT_INFO.phone}.`);
      }
    });
  }

  if(msgBtn) msgBtn.addEventListener("click", ()=>{
    if(!isOrderingOpenNow()){
      applyOrderingWindow();
      showToast(getOrderingStatusMessage());
      return;
    }
    window.open(CONTACT_INFO.messenger, "_blank");
  });

  renderCart();
}

/* ================= JOBS PAGE ================= */
function initJobs(){
  const form = document.getElementById("jobForm");
  if(!form) return;
  const phoneInput = document.getElementById("jphone");
  attachPhoneInputGuard(phoneInput);

  function readFileAsDataURL(file){
    return new Promise((resolve, reject)=>{
      if(!file){ resolve(null); return; }
      const reader = new FileReader();
      reader.onload = ()=> resolve(reader.result);
      reader.onerror = ()=> reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const data = new FormData(form);
    const phoneValue = (data.get("phone") || "").trim();
    if(!isValidPhoneNumber(phoneValue)){
      showToast("Моля, въведи валиден телефонен номер — точно 10 цифри (напр. 0888123456 или +359888123456).");
      if(phoneInput) phoneInput.focus();
      return;
    }
    const photoFile = data.get("photo");
    const cvFile = data.get("cv");
    const [photoData, cvData] = await Promise.all([
      readFileAsDataURL(photoFile && photoFile.size ? photoFile : null),
      readFileAsDataURL(cvFile && cvFile.size ? cvFile : null),
    ]);
    const fields = {
      name: data.get("name") || "",
      phone: data.get("phone") || "",
      email: data.get("email") || "",
      position: data.get("position") || "",
      experience: data.get("experience") || "",
      message: data.get("message") || "",
      photoName: photoData ? (photoFile.name || "снимка") : "",
      photoData: photoData || "",
      cvName: cvData ? (cvFile.name || "CV") : "",
      cvData: cvData || "",
    };
    createApplication(fields);
    const bodyLines = [
      `Кандидатура за работа — Витамина`,
      `Име: ${fields.name}`,
      `Телефон: ${fields.phone}`,
      `Имейл: ${fields.email}`,
      `Позиция: ${fields.position}`,
      `Опит: ${fields.experience}`,
      `Съобщение: ${fields.message}`,
      fields.photoName ? `Приложена снимка: ${fields.photoName} (виж в админ панела)` : "",
      fields.cvName ? `Приложено CV: ${fields.cvName} (виж в админ панела)` : "",
    ].filter(Boolean);
    const subject = encodeURIComponent("Кандидатура за работа — Витамина");
    const body = encodeURIComponent(bodyLines.join("\n"));
    window.location.href = `mailto:${CONTACT_INFO.email}?subject=${subject}&body=${body}`;
    showToast("Кандидатурата е записана. Отваряме имейл клиента ти...");
    form.reset();
  });
}

/* ================= ADMIN PAGE =================
   ВАЖНО: admin.html вече не сравнява паролата с текст, записан в кода
   (старото ADMIN_PASSWORD беше видимо за всеки, отворил "View Source"
   на сайта — вижте бележката в supabase/schema.sql). Влизането минава
   през истински Supabase Auth акаунт — виж инструкциите в началото на
   supabase/schema.sql как да го създадеш. ADMIN_EMAIL тук не е тайна
   (само паролата е), затова спокойно стои в кода. */
const ADMIN_EMAIL = "borisangelov.26.1@gmail.com";
async function checkAdminSupabaseSession(){
  if(!supabaseReady || !supabaseClient) return false;
  try{
    const { data } = await supabaseClient.auth.getSession();
    return !!(data && data.session);
  }catch(e){ return false; }
}

/* viewer.html пази старата, по-леко пазена парола — там няма лични
   данни, само общ брой прегледи по страница, затова не е пренесено
   към Supabase Auth. */
const ADMIN_PASSWORD = "vitamina2026";
const ADMIN_AUTH_KEY = "vitamina_admin_auth";

function isAdminLoggedIn(){ return sessionStorage.getItem(ADMIN_AUTH_KEY) === "yes"; }

function initAdmin(){
  const loginScreen = document.getElementById("adminLoginScreen");
  const panel = document.getElementById("adminPanel");
  const loginForm = document.getElementById("adminLoginForm");
  const logoutBtn = document.getElementById("adminLogout");
  if(!loginScreen || !panel) return;

  let currentOrderFilter = "all";

  const ADMIN_SEEN_ORDERS_KEY = "vitamina_admin_seen_orders_v1";
  function getSeenOrderIds(){
    try{ return JSON.parse(localStorage.getItem(ADMIN_SEEN_ORDERS_KEY)) || []; }
    catch(e){ return []; }
  }
  function saveSeenOrderIds(ids){ localStorage.setItem(ADMIN_SEEN_ORDERS_KEY, JSON.stringify(ids)); }
  let orderWatcherStarted = false;
  async function checkForNewOrders(){
    if(supabaseReady && supabaseClient){ await loadOrdersFromSupabase(); }
    const orders = getOrders();
    const seen = new Set(getSeenOrderIds());
    const freshOnes = orders.filter(o=>!seen.has(o.id));
    if(freshOnes.length){
      playOrderChime();
      showToast(freshOnes.length === 1 ? `🔔 Нова поръчка №${freshOnes[0].number}!` : `🔔 ${freshOnes.length} нови поръчки!`);
      orders.forEach(o=>seen.add(o.id));
      saveSeenOrderIds(Array.from(seen));
    }
    renderOrdersTable();
  }
  function startOrderWatcher(){
    if(orderWatcherStarted) return;
    orderWatcherStarted = true;
    checkForNewOrders();
    setInterval(checkForNewOrders, 3000);
    window.addEventListener("storage", (e)=>{
      if(e.key === ORDERS_KEY) checkForNewOrders();
    });
    // Ако е настроен споделен Supabase бекенд — синхронизация на живо между всички устройства
    attachSupabaseOrdersListener(()=>{ checkForNewOrders(); });
  }

  let appWatcherStarted = false;
  function startApplicationWatcher(){
    if(appWatcherStarted) return;
    appWatcherStarted = true;
    async function refreshApps(){
      if(supabaseReady && supabaseClient){ await loadApplicationsFromSupabase(); }
      renderAppsTable();
    }
    refreshApps();
    setInterval(refreshApps, 3000);
    window.addEventListener("storage", (e)=>{
      if(e.key === APPS_KEY) renderAppsTable();
    });
  }

  function renderOrderingPauseUI(){
    const statusEl = document.getElementById("orderingPauseStatus");
    const btn = document.getElementById("orderingPauseToggle");
    if(!statusEl || !btn) return;
    const paused = isOrderingPausedByAdmin();
    statusEl.textContent = paused ? "🚫 Поръчките са ЗАТВОРЕНИ" : "✅ Поръчките са отворени";
    statusEl.className = "status-pill " + (paused ? "status-delayed" : "status-done");
    btn.textContent = paused ? "✅ Отвори поръчките" : "🚫 Затвори поръчките";
    btn.classList.toggle("btn-danger", !paused);
    btn.classList.toggle("btn-primary", paused);
  }
  document.getElementById("orderingPauseToggle")?.addEventListener("click", ()=>{
    const nowPaused = !isOrderingPausedByAdmin();
    setOrderingPaused(nowPaused);
    renderOrderingPauseUI();
    showToast(nowPaused ? "Поръчките са затворени за клиентите — менюто си остава видимо." : "Поръчките отново са отворени.");
  });

  function showPanel(){
    loginScreen.style.display = "none";
    panel.style.display = "block";
    renderOrdersTable();
    renderAppsTable();
    renderSoupAdmin();
    renderVisitorsAdmin();
    renderOrderingPauseUI();
    startOrderWatcher();
    startApplicationWatcher();
  }

  checkAdminSupabaseSession().then(loggedIn => { if(loggedIn) showPanel(); });

  if(loginForm){
    loginForm.addEventListener("submit", async (e)=>{
      e.preventDefault();
      const pass = document.getElementById("adminPassword").value;
      const err = document.getElementById("adminLoginError");
      if(!supabaseReady || !supabaseClient){
        err.textContent = "Админ панелът изисква настроен Supabase (виж SUPABASE_URL/SUPABASE_ANON_KEY в data.js).";
        err.style.display = "block";
        return;
      }
      const { error } = await supabaseClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: pass });
      if(!error){
        err.style.display = "none";
        showPanel();
      } else {
        console.warn("Supabase вход неуспешен:", error);
        if(error.message && error.message.toLowerCase().includes("email not confirmed")){
          err.textContent = "Профилът не е потвърден — в Supabase → Authentication → Users отметни ръчно потребителя като Confirmed.";
        } else if(error.message && error.message.toLowerCase().includes("invalid login credentials")){
          err.textContent = `Грешен имейл или парола. Провери в Supabase дали потребителят е точно "${ADMIN_EMAIL}".`;
        } else {
          err.textContent = "Грешка при вход: " + (error.message || "неизвестна причина") + ".";
        }
        err.style.display = "block";
      }
    });
  }
  if(logoutBtn){
    logoutBtn.addEventListener("click", async ()=>{
      if(supabaseReady && supabaseClient){ try{ await supabaseClient.auth.signOut(); }catch(e){} }
      panel.style.display = "none";
      loginScreen.style.display = "flex";
    });
  }

  document.querySelectorAll(".admin-tabs .tab-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".admin-tabs .tab-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.tab;
      ["orders","apps","soup","visitors"].forEach(t=>{
        const el = document.getElementById("tab-"+t);
        if(el) el.style.display = (t===target) ? "block" : "none";
      });
      if(target === "visitors") renderVisitorsAdmin();
    });
  });

  function renderOrdersTable(){
    const tbody = document.getElementById("ordersTbody");
    const empty = document.getElementById("ordersEmpty");
    if(!tbody) return;
    const allOrders = getOrders();
    document.getElementById("statOrdersTotal").textContent = allOrders.length;
    document.getElementById("statOrdersNew").textContent = allOrders.filter(o=>o.status==="new").length;
    const doneCountEl = document.getElementById("statOrdersDone");
    if(doneCountEl) doneCountEl.textContent = allOrders.filter(o=>o.status==="done").length;

    const orders = currentOrderFilter === "all" ? allOrders : allOrders.filter(o=>o.status===currentOrderFilter);

    if(allOrders.length === 0){
      tbody.innerHTML = "";
      empty.style.display = "block";
      empty.textContent = "Все още няма постъпили поръчки от този браузър.";
      return;
    }
    if(orders.length === 0){
      tbody.innerHTML = "";
      empty.style.display = "block";
      empty.textContent = currentOrderFilter === "done"
        ? "Все още няма поръчки, маркирани като завършени."
        : "Няма поръчки в тази категория.";
      return;
    }
    empty.style.display = "none";
    tbody.innerHTML = orders.map(o=>{
      const itemsHtml = "<ul class='items-list'>" + o.items.map(it=>`<li>${it.qty} × ${escapeHtml(it.name)}${it.details ? " ("+escapeHtml(it.details)+")" : ""}${it.note ? `<br><span class="item-note-flag">📝 Бележка: ${escapeHtml(it.note)}</span>` : ""}</li>`).join("") + "</ul>";
      const confirmStatus = o.confirmStatus || "pending";
      const confirmPill = confirmStatus === "confirmed"
        ? `<span class="status-pill status-done">✓ Потвърдена</span>`
        : confirmStatus === "delayed"
          ? `<span class="status-pill status-delayed">🕒 Отложена (~${o.delayMinutes} мин)</span>`
          : `<span class="status-pill status-new">● Очаква отговор</span>`;
      return `
        <tr>
          <td>#${o.number}</td>
          <td>${formatDate(o.date)}</td>
          <td>${escapeHtml(o.name)}</td>
          <td><a href="tel:${escapeHtml(o.phone)}">${escapeHtml(o.phone)}</a></td>
          <td>${o.time ? escapeHtml(o.time) : "—"}</td>
          <td>${itemsHtml}</td>
          <td>${fmt(o.total)} €</td>
          <td>${o.note ? escapeHtml(o.note) : "—"}</td>
          <td>${confirmPill}</td>
          <td><span class="status-pill ${o.status==='done'?'status-done':'status-new'}">${o.status==='done' ? "✓ Завършена" : "● Нова"}</span></td>
          <td>
            <div class="order-actions">
              <button class="btn btn-sm btn-primary" data-confirm-order="${o.id}">✓ Потвърди</button>
              <button class="btn btn-sm btn-outline" data-delay-toggle="${o.id}">🕒 Не потвърждавай</button>
            </div>
            <div class="delay-picker" data-delay-picker="${o.id}" style="display:none;">
              ${[15,20,25,30,40,45,50,60].map(m=>`<button class="btn btn-sm btn-ghost" data-delay-minutes="${o.id}:${m}">${m} мин</button>`).join("")}
            </div>
            <div class="order-actions" style="margin-top:8px;">
              <button class="btn btn-sm btn-outline" data-toggle-order="${o.id}">${o.status==='done' ? "Маркирай нова" : "Маркирай завършена"}</button>
              <button class="btn btn-sm btn-danger" data-delete-order="${o.id}">Изтрий</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
    tbody.querySelectorAll("[data-confirm-order]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.dataset.confirmOrder;
        const o = confirmOrder(id);
        if(o){ sendOrderSms(o.phone, buildConfirmSmsText(o)); showToast("Потвърждението е готово за изпращане към клиента по SMS."); }
        renderOrdersTable();
      });
    });
    tbody.querySelectorAll("[data-delay-toggle]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.dataset.delayToggle;
        tbody.querySelectorAll("[data-delay-picker]").forEach(p=>{
          p.style.display = (p.dataset.delayPicker === id && p.style.display === "none") ? "flex" : "none";
        });
      });
    });
    tbody.querySelectorAll("[data-delay-minutes]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const [id, minutes] = btn.dataset.delayMinutes.split(":");
        const o = delayOrder(id, parseInt(minutes,10));
        if(o){ sendOrderSms(o.phone, buildDelaySmsText(o, minutes)); showToast("Съобщението за отлагане е готово за изпращане към клиента по SMS."); }
        renderOrdersTable();
      });
    });
    tbody.querySelectorAll("[data-toggle-order]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.dataset.toggleOrder;
        const o = getOrders().find(x=>x.id===id);
        updateOrderStatus(id, o.status==='done' ? 'new' : 'done');
        renderOrdersTable();
      });
    });
    tbody.querySelectorAll("[data-delete-order]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        if(confirm("Сигурни ли сте, че искате да изтриете тази поръчка?")){
          deleteOrder(btn.dataset.deleteOrder);
          renderOrdersTable();
        }
      });
    });
  }

  function renderAppsTable(){
    const tbody = document.getElementById("appsTbody");
    const empty = document.getElementById("appsEmpty");
    if(!tbody) return;
    const apps = getApplications();
    document.getElementById("statAppsTotal").textContent = apps.length;
    document.getElementById("statAppsNew").textContent = apps.filter(a=>a.status==="new").length;
    if(apps.length === 0){ tbody.innerHTML = ""; empty.style.display = "block"; return; }
    empty.style.display = "none";
    tbody.innerHTML = apps.map(a=>`
      <tr>
        <td>${formatDate(a.date)}</td>
        <td>${escapeHtml(a.name)}</td>
        <td><a href="tel:${escapeHtml(a.phone)}">${escapeHtml(a.phone)}</a></td>
        <td><a href="mailto:${escapeHtml(a.email)}">${escapeHtml(a.email)}</a></td>
        <td>${escapeHtml(a.position)}</td>
        <td>${a.message ? escapeHtml(a.message) : "—"}</td>
        <td>${a.photoData ? `<a href="${a.photoData}" target="_blank" rel="noopener"><img src="${a.photoData}" alt="Снимка" style="width:44px; height:44px; object-fit:cover; border-radius:8px; display:block;"></a>` : "—"}</td>
        <td>${a.cvData ? `<a href="${a.cvData}" download="${escapeHtml(a.cvName || 'CV')}">${escapeHtml(a.cvName || "CV файл")}</a>` : "—"}</td>
        <td><span class="status-pill ${a.status==='done'?'status-done':'status-new'}">${a.status==='done' ? "✓ Прегледана" : "● Нова"}</span></td>
        <td>
          <button class="btn btn-sm btn-outline" data-toggle-app="${a.id}">${a.status==='done' ? "Маркирай нова" : "Маркирай прегледана"}</button>
          <button class="btn btn-sm btn-danger" data-delete-app="${a.id}">Изтрий</button>
        </td>
      </tr>
    `).join("");
    tbody.querySelectorAll("[data-toggle-app]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.dataset.toggleApp;
        const a = getApplications().find(x=>x.id===id);
        updateApplicationStatus(id, a.status==='done' ? 'new' : 'done');
        renderAppsTable();
      });
    });
    tbody.querySelectorAll("[data-delete-app]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        if(confirm("Сигурни ли сте, че искате да изтриете тази кандидатура?")){
          deleteApplication(btn.dataset.deleteApp);
          renderAppsTable();
        }
      });
    });
  }

  function renderSoupAdmin(){
    const mount = document.getElementById("soupScheduleEditor");
    const statusEl = document.getElementById("adminSoupStatus");
    if(!mount) return;

    const dayOrder = [1,2,3,4,5,6,0]; // понеделник → неделя
    const dayLabels = {0:"Неделя",1:"Понеделник",2:"Вторник",3:"Сряда",4:"Четвъртък",5:"Петък",6:"Събота"};
    let working = JSON.parse(JSON.stringify(getWeeklySoupSchedule())); // работно копие, само в паметта до "Запази"

    function render(){
      if(statusEl){
        statusEl.innerHTML = `Днес е <b>${getTodayName()}</b> — точно супите, зададени за този ден по-долу, се показват на сайта.`;
      }
      mount.innerHTML = dayOrder.map(d=>{
        const soups = working[d] || [];
        return `
          <div class="admin-card soup-day-card" data-day="${d}">
            <h4>${dayLabels[d]}${d === getToday() ? ' <span class="admin-tag">днес</span>' : ""}</h4>
            <div class="soup-day-list">
              ${soups.map((s,i)=>`
                <div class="soup-day-entry" data-day="${d}" data-idx="${i}">
                  <div class="field">
                    <label>Име на супата</label>
                    <input type="text" data-field="name" value="${escapeHtml(s.name)}">
                  </div>
                  <div class="field">
                    <label>Описание</label>
                    <input type="text" data-field="desc" value="${escapeHtml(s.desc || "")}">
                  </div>
                  <div class="field">
                    <label>Снимка</label>
                    <div class="soup-photo-row">
                      ${s.photo ? `<img src="${s.photo}" class="soup-thumb" alt="">` : `<span class="soup-thumb-empty">Няма снимка</span>`}
                      <input type="file" accept="image/*" data-field="photo">
                    </div>
                  </div>
                  <button type="button" class="btn btn-danger btn-sm" data-remove-soup>Премахни тази супа</button>
                </div>
              `).join("") || `<p class="form-note">Няма зададени супи за този ден.</p>`}
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-add-soup="${d}">+ Добави супа за ${dayLabels[d]}</button>
          </div>
        `;
      }).join("") + `<button class="btn btn-primary btn-block" id="soupScheduleSaveBtn" style="margin-top:8px;">Запази промените по менюто със супи</button>`;

      // Синхронизира въведените текстове в `working`, без да чака "Запази"
      mount.querySelectorAll(".soup-day-entry").forEach(entry=>{
        const d = entry.dataset.day, idx = parseInt(entry.dataset.idx, 10);
        entry.querySelector('[data-field="name"]').addEventListener("input", (e)=>{ working[d][idx].name = e.target.value; });
        entry.querySelector('[data-field="desc"]').addEventListener("input", (e)=>{ working[d][idx].desc = e.target.value; });
        entry.querySelector('[data-field="photo"]').addEventListener("change", (e)=>{
          const file = e.target.files && e.target.files[0];
          if(!file) return;
          const reader = new FileReader();
          reader.onload = ()=>{ working[d][idx].photo = reader.result; render(); };
          reader.readAsDataURL(file);
        });
        entry.querySelector("[data-remove-soup]").addEventListener("click", ()=>{
          working[d].splice(idx, 1);
          render();
        });
      });
      mount.querySelectorAll("[data-add-soup]").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          const d = btn.dataset.addSoup;
          if(!working[d]) working[d] = [];
          working[d].push({ name:"Нова супа", desc:"", photo:"" });
          render();
        });
      });
      document.getElementById("soupScheduleSaveBtn").addEventListener("click", async ()=>{
        await saveWeeklySoupSchedule(working);
        showToast("Менюто със супи е запазено.");
      });
    }
    render();
  }

  function renderVisitorsAdmin(){
    const totalEl = document.getElementById("statVisitsTotal");
    const uniqueEl = document.getElementById("statVisitsUnique");
    const noteEl = document.getElementById("visitorsNote");
    if(!totalEl) return;
    totalEl.textContent = "…";
    uniqueEl.textContent = "…";
    getVisitStats().then(stats=>{
      totalEl.textContent = stats.total;
      uniqueEl.textContent = stats.unique;
      if(noteEl){
        noteEl.textContent = stats.cloudWorks
          ? "Данните са споделени от всички устройства (облачен брояч)."
          : "Облачният брояч в момента е недостъпен (напр. блокиран от adblock/VPN) — виждаш само локалния брояч на този браузър.";
      }
    });
  }

  document.getElementById("clearOrdersBtn")?.addEventListener("click", ()=>{
    if(confirm("Изтрий всички поръчки?")){ clearAllOrders(); renderOrdersTable(); }
  });
  document.querySelectorAll("[data-order-filter]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      currentOrderFilter = btn.dataset.orderFilter;
      document.querySelectorAll("[data-order-filter]").forEach(b=>b.classList.toggle("active", b===btn));
      renderOrdersTable();
    });
  });
  document.getElementById("clearAppsBtn")?.addEventListener("click", ()=>{
    if(confirm("Изтрий всички кандидатури?")){ clearAllApplications(); renderAppsTable(); }
  });
}

/* ================= VIEWER (viewer.html) =================
   Само за преглед — същата парола като admin.html (споделя
   ADMIN_AUTH_KEY, така че вход в единия панел важи и за другия),
   но без бутони за действие: само поръчки на живо и прегледи по
   страница (от Supabase таблиците "orders" и "page_view_stats"). */
function initViewer(){
  const loginScreen = document.getElementById("viewerLoginScreen");
  const panel = document.getElementById("viewerPanel");
  const loginForm = document.getElementById("viewerLoginForm");
  const logoutBtn = document.getElementById("viewerLogout");
  if(!loginScreen || !panel) return;

  let viewerWatcherStarted = false;

  function renderViewerOrders(){
    const tbody = document.getElementById("viewerOrdersTbody");
    const empty = document.getElementById("viewerOrdersEmpty");
    if(!tbody) return;
    const orders = getOrders();
    if(orders.length === 0){
      tbody.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    tbody.innerHTML = orders.map(o=>{
      const itemsHtml = "<ul class='items-list'>" + o.items.map(it=>`<li>${it.qty} × ${escapeHtml(it.name)}${it.details ? " ("+escapeHtml(it.details)+")" : ""}${it.note ? `<br><span class="item-note-flag">📝 Бележка: ${escapeHtml(it.note)}</span>` : ""}</li>`).join("") + "</ul>";
      const confirmStatus = o.confirmStatus || "pending";
      const confirmPill = confirmStatus === "confirmed"
        ? `<span class="status-pill status-done">✓ Потвърдена</span>`
        : confirmStatus === "delayed"
          ? `<span class="status-pill status-delayed">🕒 Отложена (~${o.delayMinutes} мин)</span>`
          : `<span class="status-pill status-new">● Очаква отговор</span>`;
      return `
        <tr>
          <td>#${o.number}</td>
          <td>${formatDate(o.date)}</td>
          <td>${escapeHtml(o.name)}</td>
          <td><a href="tel:${escapeHtml(o.phone)}">${escapeHtml(o.phone)}</a></td>
          <td>${o.time ? escapeHtml(o.time) : "—"}</td>
          <td>${itemsHtml}</td>
          <td>${fmt(o.total)} €</td>
          <td>${o.note ? escapeHtml(o.note) : "—"}</td>
          <td>${confirmPill}</td>
          <td><span class="status-pill ${o.status==='done'?'status-done':'status-new'}">${o.status==='done' ? "✓ Завършена" : "● Нова"}</span></td>
        </tr>
      `;
    }).join("");
  }

  function renderViewerPageStats(){
    const tbody = document.getElementById("viewerPageStatsTbody");
    const empty = document.getElementById("viewerPageStatsEmpty");
    if(!tbody) return;
    if(!supabaseReady || !supabaseClient){
      tbody.innerHTML = "";
      empty.style.display = "block";
      empty.textContent = "Няма връзка със Supabase — прегледите по страница не са налични.";
      return;
    }
    supabaseClient
      .from("page_view_stats")
      .select("*")
      .then(({ data, error })=>{
        if(error){
          empty.style.display = "block";
          empty.textContent = "Не може да заредим прегледите по страница.";
          return;
        }
        const rows = data || [];
        if(rows.length === 0){
          tbody.innerHTML = "";
          empty.style.display = "block";
          empty.textContent = "Все още няма записани прегледи.";
          return;
        }
        empty.style.display = "none";
        tbody.innerHTML = rows.map(r=>`
          <tr>
            <td>${escapeHtml(r.page)}</td>
            <td>${r.total_views}</td>
            <td>${r.unique_views}</td>
            <td>${r.last_viewed_at ? formatDate(r.last_viewed_at) : "—"}</td>
          </tr>
        `).join("");
      })
      .catch(()=>{
        empty.style.display = "block";
        empty.textContent = "Не може да заредим прегледите по страница.";
      });
  }

  function startViewerWatcher(){
    if(viewerWatcherStarted) return;
    viewerWatcherStarted = true;
    renderViewerPageStats();
    setInterval(renderViewerOrders, 2000);
    setInterval(renderViewerPageStats, 15000);
  }

  function showPanel(){
    loginScreen.style.display = "none";
    panel.style.display = "block";
    renderViewerOrders();
    startViewerWatcher();
  }

  if(isAdminLoggedIn()) showPanel();

  if(loginForm){
    loginForm.addEventListener("submit", (e)=>{
      e.preventDefault();
      const pass = document.getElementById("viewerPassword").value;
      const err = document.getElementById("viewerLoginError");
      if(pass === ADMIN_PASSWORD){
        sessionStorage.setItem(ADMIN_AUTH_KEY, "yes");
        err.style.display = "none";
        showPanel();
      } else {
        err.style.display = "block";
      }
    });
  }
  if(logoutBtn){
    logoutBtn.addEventListener("click", ()=>{
      sessionStorage.removeItem(ADMIN_AUTH_KEY);
      panel.style.display = "none";
      loginScreen.style.display = "flex";
    });
  }
}

/* ================= INIT ================= */
document.addEventListener("DOMContentLoaded", ()=>{
  initSupabaseSync();
  initNav();
  initLeafField();
  initHome();
  initMenu();
  initCart();
  initJobs();
  initAdmin();
  initViewer();
  initReveal();
  if(!document.getElementById("adminLoginScreen") && !document.getElementById("viewerLoginScreen")) trackVisit();
});