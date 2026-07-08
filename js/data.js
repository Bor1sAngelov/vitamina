/* =========================================================
   ВИТАМИНА — Салатен бар, Враца
   Реално меню на обекта, с грамажи, съставки и цени.
   Цените по-долу са въведени в лева (както идват от системата на
   обекта), но на сайта се показват в евро — виж EUR_RATE и функцията
   fmt() в js/script.js. За да смените цена, просто редактирайте
   числото тук — превръщането в евро е автоматично.
   Хранителните стойности (kcal / протеини / въглехидрати / мазнини)
   са ориентировъчни оценки на база съставките — за уточнена
   информация се допитайте на място.
   ========================================================= */

/* ================= СПОДЕЛЕНА БАЗА ДАННИ (Supabase) =================
   За да се вижда ВСЯКА поръчка от ВСЯКО устройство (клиент поръчва от
   телефона си → веднага се появява на компютъра на екипа), сайтът може
   да използва Supabase като общ backend. Ако стойностите по-долу са
   попълнени, сайтът ще синхронизира поръчките и паузата за поръчване.
*/
const SUPABASE_URL = "https://lehortzcrkqzuyyzwfts.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_1qEg7Va26dFo1kyewrUJcg_B2InxB_d";

/* ================= СПИРАНЕ НА ПОРЪЧКИТЕ (бутон в админ панела) ================= */
const ORDERING_PAUSED_KEY = "vitamina_ordering_paused_v1";
const ORDERING_PAUSED_MESSAGE = "Здравейте, поради голямата натовареност за момента не приемаме поръчки онлайн! Пробвайте отново след малко! Благодарим!";

const CONTACT_INFO = {
  phone: "089 671 7196",
  phoneHref: "+359896717196",
  email: "salatbarvitamina@gmail.com",
  facebook: "https://www.facebook.com/vitaminasaladbar/",
  messenger: "https://m.me/vitaminasaladbar",
  /* ⚠️ Не успяхме да потвърдим със сигурност точните профили —
     сложи тук истинските линкове, преди да пуснеш сайта на живо. */
  instagram: "https://www.instagram.com/vitaminasaladbar/",
  tiktok: "https://www.tiktok.com/@vitaminasaladbar",
  address: "ул. „Полковник Лукашов“ 4, Враца 3000",
  hours: "Пон–Пет: 9:00 – 19:00 ч. · Съб–Нед: 10:00 – 17:00 ч.",
};

/* ================= РАБОТНО ВРЕМЕ ================= */
/* Ключовете съвпадат с Date.getDay() (0 = неделя ... 6 = събота).
   За да смените работно време, просто редактирайте часовете тук —
   навсякъде по сайта (текстове, банер, форма за поръчка) се обновява
   автоматично. */
const WORKING_HOURS = {
  0: { open: "10:00", close: "17:00" }, // неделя
  1: { open: "06:00", close: "19:00" }, // понеделник
  2: { open: "09:00", close: "19:00" }, // вторник
  3: { open: "09:00", close: "19:00" }, // сряда
  4: { open: "09:00", close: "19:00" }, // четвъртък
  5: { open: "09:00", close: "19:00" }, // петък
  6: { open: "10:00", close: "17:00" }, // събота
};

/* Поръчки се приемат само между отварянето и (затварянето минус
   този брой минути) — т.е. най-късно 15 мин. преди края на
   работния ден, и никога извън работно време. */
const ORDER_CUTOFF_MINUTES = 15;

/* Клиентът трябва да изчака поне толкова минути от момента на
   поръчката, преди да мине да си вземе поръчката (нужно е време
   салатите да се приготвят). Часовете за избор в поръчката се
   генерират на стъпки от TIME_SLOT_STEP_MINUTES минути, само в
   рамките на работното време. */
const MIN_PICKUP_WAIT_MINUTES = 20;
const TIME_SLOT_STEP_MINUTES = 15;

const WEEKDAY_NAMES = ["неделя","понеделник","вторник","сряда","четвъртък","петък","събота"];

function timeStrToMinutes(str){
  const [h, m] = String(str).split(":").map(Number);
  return h * 60 + m;
}
function minutesToTimeStr(mins){
  mins = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60), m = mins % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
function getHoursFor(date){
  return WORKING_HOURS[date.getDay()];
}
function getOrderingWindow(date){
  const hours = getHoursFor(date);
  const openMin = timeStrToMinutes(hours.open);
  const closeMin = timeStrToMinutes(hours.close);
  return { hours, openMin, closeMin, cutoffMin: closeMin - ORDER_CUTOFF_MINUTES };
}
function isOrderingOpenNow(date = new Date()){
  const { openMin, cutoffMin } = getOrderingWindow(date);
  const nowMin = date.getHours() * 60 + date.getMinutes();
  return nowMin >= openMin && nowMin <= cutoffMin;
}
function getNextOpening(date){
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  const hours = getHoursFor(next);
  return { dayName: WEEKDAY_NAMES[next.getDay()], open: hours.open };
}
function getOrderingStatusMessage(date = new Date()){
  const { hours, openMin, cutoffMin } = getOrderingWindow(date);
  const nowMin = date.getHours() * 60 + date.getMinutes();
  if(nowMin < openMin){
    return `Все още сме затворени — днес приемаме поръчки от ${hours.open} до ${minutesToTimeStr(cutoffMin)} ч.`;
  }
  if(nowMin > cutoffMin){
    const next = getNextOpening(date);
    return `Работното време приключи за днес (поръчки се приемат до ${minutesToTimeStr(cutoffMin)} ч.). Очакваме те в ${next.dayName} от ${next.open} ч.`;
  }
  return `Приемаме поръчки до ${minutesToTimeStr(cutoffMin)} ч. днес.`;
}
/* Връща списък с валидни часове за вземане ("HH:MM") за подадения
   момент: най-рано MIN_PICKUP_WAIT_MINUTES напред от сега (закръглено
   нагоре до следваща стъпка от TIME_SLOT_STEP_MINUTES), но не преди
   отварянето, и най-късно до крайния срок за поръчки (виж
   getOrderingWindow). Ако денят вече е приключил за поръчки, връща
   празен списък. */
function getAvailablePickupSlots(date = new Date()){
  const { openMin, cutoffMin } = getOrderingWindow(date);
  const nowMin = date.getHours() * 60 + date.getMinutes();

  let earliest = Math.max(openMin, nowMin + MIN_PICKUP_WAIT_MINUTES);
  earliest = Math.ceil(earliest / TIME_SLOT_STEP_MINUTES) * TIME_SLOT_STEP_MINUTES;

  const slots = [];
  for(let t = earliest; t <= cutoffMin; t += TIME_SLOT_STEP_MINUTES){
    slots.push(minutesToTimeStr(t));
  }
  return slots;
}

function formatWorkingHoursSchedule(){
  return WEEKDAY_NAMES.map((name, idx) => {
    const h = WORKING_HOURS[idx];
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    return `${label}: ${h.open} – ${h.close} ч.`;
  });
}

/* Поръчката се подготвя структурирано и се изпраща по имейл към
   екипа на Витамина. Когато обектът се свърже с истинска система
   за поръчки (напр. собствен бекенд), попълнете адреса тук — кодът
   вече изпраща количката в готов JSON формат преди да отвори имейла. */
const ORDER_API_ENDPOINT = "";

async function pushOrderToVitaminaSystem(order){
  if(!ORDER_API_ENDPOINT) return { ok:false, skipped:true };
  try{
    const res = await fetch(ORDER_API_ENDPOINT, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(order)
    });
    return { ok: res.ok };
  }catch(err){
    return { ok:false, error:err };
  }
}

/* ================= ПЪЛНО МЕНЮ ================= */
const MENU_DATA = [
  { category:"Супи", icon:"🥣", items:[
    /* Попълва се динамично от script.js със супите за деня (виж
       getTodaysSoups() по-долу) плюс таратора — не редактирайте тук. */
  ]},

  { category:"Салати", icon:"🥗", items:[
    { id:"sal1", photo:"img/salads/fines.jpg",  name:"Финес",     price:7.43, weight:"480 г", desc:"Зелена салата, краставица, морков, зеле, царевица, копър и кашкавал.", nut:{kcal:442,p:24,c:39,f:23}, smallSize:{ weight:"300 г", price:6.45 } },
    { id:"sal2", photo:"img/salads/izobilie.jpg",  name:"Изобилие",  price:8.21, weight:"550 г", desc:"Домат, паста, пилешко филе, зелена салата, авокадо, магданоз и чушка.", nut:{kcal:371,p:36,c:58,f:8}, smallSize:{ weight:"350 г", price:6.45 } },
    { id:"sal3", photo:"img/salads/balgarka.jpg",  name:"Българка",  price:7.43, weight:"520 г", desc:"Зелена салата, домат, краставица, сирене, маслини и магданоз.", nut:{kcal:465,p:18,c:36,f:19}, smallSize:{ weight:"320 г", price:6.45 } },
    { id:"sal4", photo:"img/salads/vitamina.jpg",  name:"Витамина",  price:7.43, weight:"400 г", desc:"Цвекло, морков, зелена ябълка, чесън и копър.", nut:{kcal:366,p:8,c:60,f:15}, smallSize:{ weight:"250 г", price:6.45 } },
    { id:"sal5", photo:"img/salads/efekt.jpg",  name:"Ефект",     price:8.21, weight:"450 г", desc:"Домат, зеле, цвекло, маслини, плочка сирене с магданозено песто, копър и тиквено семе.", nut:{kcal:581,p:23,c:34,f:33}, smallSize:{ weight:"300 г", price:6.45 } },
    { id:"sal6", photo:"img/salads/papagal.jpg",  name:"Папагал",   price:9.39, weight:"480 г", desc:"Домат, краставица, чушка, авокадо, спанак, морков, киноа, нар, магданоз и пресен лук.", nut:{kcal:265,p:10,c:48,f:5}, smallSize:{ weight:"300 г", price:7.43 } },
    { id:"sal7", photo:"img/salads/cezar.jpg",  name:"Цезар",     price:8.61, weight:"530 г", desc:"Зелена салата, краставица, домат, пилешко филе, крутони, млечен дресинг и пармезан.", nut:{kcal:488,p:25,c:49,f:21}, smallSize:{ weight:"330 г", price:6.45 } },
    { id:"sal8", photo:"img/salads/bulgur.jpg",  name:"Булгур",    price:7.43, weight:"450 г", desc:"Краставица, булгур, морков, чушка, пресен лук, магданоз, копър и сирене с млечен дресинг.", nut:{kcal:428,p:19,c:36,f:24}, smallSize:{ weight:"300 г", price:6.45 } },
    { id:"sal9", photo:"img/salads/riba-ton.jpg",  name:"Риба тон",  price:8.21, weight:"480 г", desc:"Морков, зелена салата, авокадо, домат, яйце, риба тон и копър.", nut:{kcal:257,p:22,c:35,f:10}, smallSize:{ weight:"320 г", price:6.45 } },
    { id:"sal10", photo:"img/salads/amerikano.jpg", name:"Американо", price:8.21, weight:"480 г", desc:"Зелен боб, бекон, зелена салата, пресен лук, пармезан, яйце, дресинг горчица и крутони.", nut:{kcal:576,p:22,c:44,f:32}, nutNote:"калориите са без дресинг", smallSize:{ weight:"320 г", price:6.45 } },
    { id:"sal11", photo:"img/salads/zasita.jpg", name:"Засита",    price:9.39, weight:"520 г", desc:"Моцарела, домат, спанак, нахут, магданоз, шунка, морков и гъби.", nut:{kcal:477,p:35,c:43,f:22}, smallSize:{ weight:"320 г", price:7.43 } },
    { id:"sal12", photo:"img/salads/zdrave.jpg", name:"Здраве",    price:8.21, weight:"450 г", desc:"Спанак, цвекло, авокадо, зелена ябълка, домат и сусам.", nut:{kcal:387,p:10,c:47,f:19}, smallSize:{ weight:"300 г", price:6.45 } },
    { id:"sal13", photo:"img/salads/zelena.jpg", name:"Зелена",    price:8.21, weight:"400 г", desc:"Спанак, зелена ябълка, краставица, чушка, авокадо, копър и магданоз.", nut:{kcal:355,p:10,c:40,f:19}, smallSize:{ weight:"250 г", price:6.45 } },
  ]},

  { category:"Дресинги", icon:"🥄", items:[
    { id:"dr1",  name:"Млечен дресинг",     price:0.78, desc:"Кисело мляко, майонеза, сол, копър и чесън.", nut:{kcal:142,p:2,c:3,f:13} },
    { id:"dr2",  name:"Лимонов дресинг",    price:0.78, desc:"Лимонов сок, зехтин, сол и чесън.", nut:{kcal:317,p:1,c:3,f:34} },
    { id:"dr3",  name:"Магданозен дресинг",price:0.78, desc:"Магданоз, сол, чесън, оцет, олио и захар.", nut:{kcal:65,p:1,c:4,f:5} },
    { id:"dr4",  name:"Дресинг Дженовезе", price:2.35, desc:"Босилек, чесън, зехтин, сол, индийско кашу и пармезан.", nut:{kcal:163,p:3,c:3,f:16} },
    { id:"dr5",  name:"Медена горчица",    price:0.78, desc:"Горчица, мед, олио, оцет и сол.", nut:{kcal:424,p:2,c:11,f:41} },
    { id:"dr6",  name:"Авокадо дресинг",   price:0.78, desc:"Авокадо, лимонов сок, майонеза, кисело мляко, сол и черен пипер.", nut:{kcal:88,p:1,c:2,f:8} },
    { id:"dr7",  name:"Фреш лимон",        price:0.59, desc:"Прясно изцеден лимонов сок.", nut:{kcal:5,p:0,c:1,f:0} },
    { id:"dr8",  name:"Хумус",             price:1.17, desc:"Нахут, тахан, лимонов сок и подправки.", nut:{kcal:147,p:3,c:9,f:12} },
    { id:"dr9",  name:"Сладък тахан",      price:1.56, desc:"Пълнозърнест тахан с мед.", nut:{kcal:140,p:3,c:10,f:10} },
    { id:"dr10", name:"Лют дресинг",       price:1.56, desc:"Мед, чили, чушка, лимон и олио.", nut:{kcal:105,p:0,c:12,f:6} },
    { id:"dr11", name:"Черен пипер",       price:0.20, desc:"Добавка към купа зеленчуци.", nut:{kcal:5,p:0,c:1,f:0} },
    { id:"dr12", name:"Мед",               price:0.39, desc:"Добавка към купа зеленчуци.", nut:{kcal:20,p:0,c:5,f:0} },
  ]},

  { category:"Бургери", icon:"🍔", items:[
    { id:"bur1", name:"Бургер „Класик“",       price:7.63, photo:"img/burgers/klasik.jpg", desc:"Пълнозърнесто хлебче, пилешко филе, зелена салата, домат, краставица, чедър и млечен сос.", nut:{kcal:610,p:33,c:73,f:18.5} },
    { id:"bur2", name:"Веган бургер",          price:7.04, photo:"img/burgers/vegan.jpg", desc:"Пълнозърнесто хлебче, хумус, домат, краставица, печена чушка и маслини.", nut:{kcal:736,p:28,c:109,f:18} },
    { id:"bur3", name:"Цветен бургер",         price:8.61, photo:"img/burgers/tsveten.jpg", desc:"Пълнозърнесто хлебче, шунка, домат, босилеково песто, царевица, морков и ементал.", nut:{kcal:605,p:27,c:79,f:16} },
    { id:"bur4", name:"Бургер с риба тон",     price:7.63, photo:"img/burgers/riba-ton.jpg", desc:"Пълнозърнесто хлебче, риба тон, зелена салата, краставица, маслини, ементал и млечен сос.", nut:{kcal:611,p:27,c:73,f:18.5} },
    { id:"bur5", name:"Бургер „Детски спомен“",price:7.04, photo:"img/burgers/detski-spomen.jpg", desc:"Пълнозърнесто хлебче, магданозено песто, сирене, печена чушка, домат, краставица и поръска от пресен лук.", nut:{kcal:587,p:22,c:77,f:17} },
    { id:"bur6", name:"Сладък бургер",         price:7.04, photo:"img/burgers/sladak-burger.jpg", desc:"Пълнозърнесто хлебче със сусамов тахан, ябълка, мед, тиквено семе и канела.", nut:{kcal:638,p:13,c:70,f:36} },
  ]},

  { category:"Десерти", icon:"🍓", items:[
    { id:"des1", name:"Кисело мляко с чия и плодове",            price:4.89, weight:"300 г", photo:"img/desserts/kiselo-mliako-chia.jpg", desc:"Кисело мляко, чия и свежи сезонни плодове.", nut:{kcal:188,p:10,c:11,f:11} },
    { id:"des2", name:"Гръцки йогурт с боровинки и фурми",       price:5.87, weight:"300 г", photo:"img/desserts/grazki-yogurt.jpg", desc:"Йогурт, сушени боровинки, фурми и хрупкаво мюсли.", nut:{kcal:264,p:8,c:28,f:14}, nutNote:"калориите са без мюслите" },
    { id:"des3", name:"Лимонено изкушение",                      price:6.06, weight:"200 г", photo:"img/desserts/limoneno-izkushenie.jpg", desc:"Лимонов сок, лайм, мляко, маскарпоне, лимонова кора и бисквити.", nut:{kcal:752,p:19,c:77,f:45} },
    { id:"des4", name:"Житно-плодова салата",                    price:5.09, weight:"200 г", photo:"img/desserts/zhitno-plodova.jpg", desc:"Сварено жито, ябълки, стафиди, орехи, портокалова кора и канела.", nut:{kcal:431,p:8,c:67,f:17} },
    { id:"des5", name:"Пудинг с тиква",                          price:5.87, weight:"200 г", photo:"img/desserts/puding-tikva.jpg", desc:"Тиква, захар, крема сирене, канела и чаени бисквити. *Сезонен.", nut:{kcal:292,p:5,c:46,f:61} },
    { id:"des6", name:"Кокосови бонбони",                        price:6.85, weight:"12 бр.", photo:"img/desserts/kokosovi-bonboni.jpg", desc:"Кокосови стърготини, кокосово мляко, кокосово масло, кондензирано мляко и ванилия.", nut:{kcal:552,p:12,c:48,f:36} },
    { id:"des7", name:"Мус с банан и чия",                       price:5.87, weight:"200 г", photo:"img/desserts/mus-banan-chia.jpg", desc:"Банан, чия, кокосово мляко, черен шоколад, стевия и кокосови стърготини.", nut:{kcal:344,p:5,c:31,f:27} },
    { id:"des8", name:"Шоколадови трюфели",                      price:7.04, weight:"12 бр., кутия", photo:"img/desserts/shokoladovi-tryufeli.jpg", desc:"Орехови ядки, стафиди, кокосово мляко, черен шоколад, какаови бисквити и кокосово масло.", nut:{kcal:552,p:7,c:60,f:36} },
    { id:"des9", name:"Лятна хармония",                          price:6.26, weight:"200 г", photo:"img/desserts/harmonia.jpg", desc:"Скир, маскарпоне, фурми, кокосови стърготини, мед, ванилия и сезонни плодове.", nut:{kcal:620,p:14,c:45,f:42} },
  ]},

  { category:"Смути", icon:"🥤", items:[
    { id:"sm1", name:"Зелено смути",         photo:"img/smoothies/zeleno-smuti.jpg", desc:"Спанак, банан, ананас, чия и бадемово мляко.",
      sizes:[
        { label:"350 мл.", price:8.02, nut:{kcal:210,p:5,c:36,f:6} },
        { label:"500 мл.", price:9.58, nut:{kcal:300,p:7,c:52,f:8}, isDefault:true },
      ] },
    { id:"sm2", name:"Смути „Розова мечта“", photo:"img/smoothies/rozova-mechta.jpg", desc:"Малини, ягоди, ябълка, йогурт и мед.",
      sizes:[
        { label:"350 мл.", price:7.63, nut:{kcal:217,p:5,c:42,f:3} },
        { label:"500 мл.", price:9.00, nut:{kcal:310,p:7,c:60,f:4}, isDefault:true },
      ] },
    { id:"sm3", name:"Смути „Енерджи“",      photo:"img/smoothies/energy.jpg", desc:"Банан, овесени ядки, бадеми, прясно мляко, канела и мед.",
      sizes:[
        { label:"350 мл.", price:7.63, nut:{kcal:273,p:8,c:42,f:8} },
        { label:"500 мл.", price:9.00, nut:{kcal:390,p:12,c:60,f:12}, isDefault:true },
      ] },
    { id:"sm4", name:"Детокс смути",         photo:"img/smoothies/detoks.jpg", desc:"Магданоз, краставица, спанак, морков и филтрирана вода.",
      sizes:[
        { label:"350 мл.", price:7.04, nut:{kcal:91,p:2,c:18,f:1} },
        { label:"500 мл.", price:8.61, nut:{kcal:130,p:3,c:26,f:1}, isDefault:true },
      ] },
  ]},

  { category:"Фреш", icon:"🍊", items:[
    { id:"fr1", name:"Портокал", desc:"Прясно изцеден портокалов сок.", photo:"img/Juice/Orange.jpeg",
      sizes:[
        { label:"300 мл.", price:4.50,  nut:{kcal:126,p:2,c:28,f:0} },
        { label:"500 мл.", price:6.45,  nut:{kcal:210,p:3,c:47,f:0}, isDefault:true },
        { label:"1 л.",    price:13.10, nut:{kcal:420,p:6,c:94,f:0} },
      ] },
    { id:"fr2", name:"Ябълка", desc:"Прясно изцеден ябълков сок.", photo:"img/Juice/Apple.jpg",
      sizes:[
        { label:"300 мл.", price:5.09,  nut:{kcal:135,p:0,c:33,f:0} },
        { label:"500 мл.", price:7.04,  nut:{kcal:225,p:0,c:55,f:0}, isDefault:true },
        { label:"1 л.",    price:14.08, nut:{kcal:450,p:0,c:110,f:0} },
      ] },
    { id:"fr3", name:"Морков", desc:"Прясно изцеден морковен сок.", photo:"img/Juice/Carrot.jpg",
      sizes:[
        { label:"300 мл.", price:5.09,  nut:{kcal:99,p:2,c:22,f:0} },
        { label:"500 мл.", price:7.04,  nut:{kcal:165,p:4,c:37,f:0}, isDefault:true },
        { label:"1 л.",    price:14.08, nut:{kcal:330,p:8,c:74,f:0} },
      ] },
    { id:"fr4", name:"Грейпфрут", desc:"Прясно изцеден грейпфрутов сок.", photo:"img/Juice/Greip.jpg",
      sizes:[
        { label:"300 мл.", price:5.48,  nut:{kcal:105,p:1,c:25,f:0} },
        { label:"500 мл.", price:7.63,  nut:{kcal:175,p:2,c:42,f:0}, isDefault:true },
        { label:"1 л.",    price:15.06, nut:{kcal:350,p:4,c:84,f:0} },
      ] },
    { id:"fr5", name:"Фреш микс", desc:"Портокал, ябълка, морков и грейпфрут.", photo:"img/Juice/Miks.jpg",
      sizes:[
        { label:"300 мл.", price:5.48,  nut:{kcal:120,p:1,c:28,f:0} },
        { label:"500 мл.", price:8.02,  nut:{kcal:200,p:2,c:46,f:0}, isDefault:true },
        { label:"1 л.",    price:16.04, nut:{kcal:400,p:4,c:92,f:0} },
      ] },
  ]},

  { category:"Балансирана купа зеленчуци", icon:"🍲", items:[
    { id:"bowl1", name:"Купа с пиле",     price:8.61,  weight:"500 г", photo:"img/bowls/kupa-pile.jpg", desc:"Картофи на пара, моркови на пара, пилешко филе, маслини, пресен лук, яйце и лимонов дресинг.", nut:{kcal:386,p:26,c:37,f:7}, nutNote:"калориите са без дресинг" },
    { id:"bowl2", name:"Купа с риба",     price:10.56, weight:"400 г", photo:"img/bowls/kupa-riba.jpg", desc:"Ориз на пара, пресен спанак, риба тон, маслини, пармезан, авокадо, яйце, копър и лимонов дресинг.", nut:{kcal:609,p:30,c:54,f:21}, nutNote:"калориите са без дресинг" },
    { id:"bowl3", name:"Купа със сирена", price:8.80,  weight:"500 г", photo:"img/bowls/kupa-sirena.jpg", desc:"Броколи на пара, картоф на пара, нахут, кашкавал, моцарела, пресен лук, авокадо и лимонов дресинг.", nut:{kcal:761,p:45,c:53,f:44}, nutNote:"калориите са без дресинг" },
  ]},
];

/* =========================================================
   „НАПРАВИ СИ САМ“ — салата и бургер, точно съставките и
   цените от реалното меню (мин. 5 съставки за всеки от двата).
   ========================================================= */
const DIY_INGREDIENTS = [
  { id:"i-chicken",   name:"Пилешко филе",        price:1.96, nut:{kcal:78,p:16,c:1,f:1} },
  { id:"i-parmesan",  name:"Пармезан",             price:1.17, nut:{kcal:104,p:1,c:12,f:6} },
  { id:"i-mozzarella",name:"Моцарела",             price:1.96, nut:{kcal:240,p:18,c:2,f:18} },
  { id:"i-bacon",     name:"Бекон",                price:1.56, nut:{kcal:222,p:9,c:1,f:20} },
  { id:"i-spinach",   name:"Спанак",               price:1.56, nut:{kcal:18,p:2,c:3,f:0} },
  { id:"i-cheese",    name:"Сирене",               price:1.56, nut:{kcal:207,p:12,c:1,f:17} },
  { id:"i-tuna",      name:"Риба тон",             price:1.96, nut:{kcal:52,p:12,c:0,f:1} },
  { id:"i-ham",       name:"Шунка",                price:1.17, nut:{kcal:61,p:8,c:2,f:2} },
  { id:"i-cheddar",   name:"Чедър на слайс",       price:1.56, nut:{kcal:100,p:6,c:1,f:8} },
  { id:"i-kashkaval", name:"Кашкавал",             price:1.56, nut:{kcal:274,p:18,c:0,f:23} },
  { id:"i-avocado",   name:"Авокадо",              price:1.56, nut:{kcal:40,p:1,c:2,f:4} },
  { id:"i-roastpep",  name:"Печена червена чушка", price:1.17, nut:{kcal:26,p:1,c:5,f:1} },
  { id:"i-lettuce",   name:"Зелена салата",        price:1.17, nut:{kcal:18,p:1,c:4,f:0} },
  { id:"i-cucumber",  name:"Краставица",           price:1.17, nut:{kcal:17,p:1,c:4,f:0} },
  { id:"i-tomato",    name:"Домат",                price:1.17, nut:{kcal:16,p:1,c:4,f:0} },
  { id:"i-redbean",   name:"Червен боб",           price:1.17, nut:{kcal:99,p:7,c:13,f:1} },
  { id:"i-cabbage",   name:"Зеле",                 price:1.17, nut:{kcal:38,p:2,c:9,f:0} },
  { id:"i-carrot",    name:"Морков",               price:1.17, nut:{kcal:53,p:1,c:12,f:0} },
  { id:"i-greenapple",name:"Зелена ябълка",        price:1.56, nut:{kcal:89,p:0,c:23,f:0} },
  { id:"i-pepper",    name:"Чушка",                price:1.17, nut:{kcal:19,p:1,c:4,f:0} },
  { id:"i-beet",      name:"Цвекло",               price:1.17, nut:{kcal:52,p:2,c:11,f:0} },
  { id:"i-chickpea",  name:"Нахут",                price:1.17, nut:{kcal:76,p:4,c:19,f:2} },
  { id:"i-bulgur",    name:"Булгур",               price:1.56, nut:{kcal:52,p:2,c:12,f:0} },
  { id:"i-greenbean", name:"Зелен боб",            price:1.17, nut:{kcal:36,p:2,c:4,f:0} },
  { id:"i-quinoa",    name:"Киноа",                price:1.17, nut:{kcal:80,p:3,c:14,f:1} },
  { id:"i-seeds",     name:"Семена и ядки",        price:1.17, nut:{kcal:170,p:7,c:4,f:15} },
  { id:"i-corn",      name:"Царевица",             price:1.17, nut:{kcal:42,p:1,c:10,f:0} },
  { id:"i-olives",    name:"Маслини",              price:1.17, nut:{kcal:94,p:1,c:2,f:1} },
  { id:"i-macaroni",  name:"Паста",                price:1.17, nut:{kcal:200,p:6,c:46,f:1} },
  { id:"i-egg",       name:"Яйце",                 price:1.17, nut:{kcal:78,p:6,c:1,f:5} },
  { id:"i-croutons",  name:"Крутони",              price:1.17, nut:{kcal:113,p:3,c:21,f:1} },
  { id:"i-mushroom",  name:"Гъби",                 price:1.17, nut:{kcal:13,p:1,c:1,f:0} },
  { id:"i-scallion",  name:"Зелен лук",            price:1.17, nut:{kcal:10,p:1,c:2,f:0} },
  { id:"i-pomegranate",name:"Нар",                 price:1.56, nut:{kcal:17,p:0,c:4,f:0} },
  { id:"i-emmental",  name:"Ементал",              price:1.56, nut:{kcal:105,p:7,c:1,f:8} },
];

const DIY_BREAD_WHEAT = { id:"i-bread-wheat", name:"Пълнозърнесто хлебче / Питка", price:1.56, nut:{kcal:384,p:13,c:65,f:3} };

/* За "Направи си сам" САЛАТА ементалът не е налична съставка (само за
   купа/бургер) — затова отделен списък само за салатата. */
const DIY_INGREDIENTS_SALAD = DIY_INGREDIENTS.filter(i => i.id !== "i-emmental");

const DIY_DRESSINGS = MENU_DATA.find(c=>c.category==="Дресинги").items;

/* Опция "Без дресинг" — само за конструктора "Направи си сам"
   (салата/купа). Не се показва като продукт в категория "Дресинги",
   само в падащото меню на конструктора, като избор по подразбиране. */
const DIY_NO_DRESSING = { id:"no-dressing", name:"Без дресинг", price:0, nut:{kcal:0,p:0,c:0,f:0} };
const DIY_DRESSING_OPTIONS = [DIY_NO_DRESSING, ...DIY_DRESSINGS];

/* Топла основа за "Направи си купа" — само като съставки в конструктора
   (вече не е самостоятелна категория в менюто, виж задача №3). */
const DIY_BOWL_BASE = [
  { id:"base-rice",     name:"Ориз на пара",    price:1.76, nut:{kcal:156,p:3,c:34,f:0} },
  { id:"base-potato",   name:"Картоф на пара",  price:1.76, nut:{kcal:103,p:2,c:24,f:0} },
  { id:"base-broccoli", name:"Броколи на пара", price:1.76, nut:{kcal:28,p:2,c:6,f:0} },
  { id:"base-carrot",   name:"Морков на пара",  price:1.76, nut:{kcal:28,p:1,c:7,f:0} },
];

const BUILDERS = {
  salad: {
    label:"Салата — направи си сам",
    icon:"🥗",
    intro:"Избери съставки и дресинг по избор (или без дресинг). Цената тръгва от 0 € и расте с всяка добавена съставка — точно както на място в обекта. Минималната стойност за салата е 3.30 €.",
    minPrice:3.30,
    hasDressing:true,
    ingredients: DIY_INGREDIENTS_SALAD,
    dressings: DIY_DRESSING_OPTIONS,
    finishLabel:"Добави салатата в количката",
  },
  bowl: {
    label:"Купа — направи си сам",
    icon:"🍲",
    intro:"Избери топла основа (ориз, картоф, броколи, морков) и добавки по избор, плюс дресинг по избор (или без дресинг). Минималната стойност за купа е 3.80 €.",
    minPrice:3.80,
    hasDressing:true,
    ingredients: [...DIY_BOWL_BASE, ...DIY_INGREDIENTS],
    dressings: DIY_DRESSING_OPTIONS,
    finishLabel:"Добави купата в количката",
  },
  burger: {
    label:"Бургер — направи си сам",
    icon:"🍔",
    intro:"Хлебчето е избрано автоматично — добави и други съставки по избор. Минималната стойност за бургер е 3.60 €.",
    minPrice:3.60,
    hasDressing:false,
    ingredients: [DIY_BREAD_WHEAT, ...DIY_INGREDIENTS],
    defaultSelected: [DIY_BREAD_WHEAT.id],
    finishLabel:"Добави бургера в количката",
  },
};

/* ================= СУПИ НА ДЕНЯ + ТАРАТОР =================
   Всеки ден от седмицата може да има 1 или повече супи (списък).
   Редактируеми изцяло от админ панела (таб "Супа на деня") — там
   могат да се добавят/премахват супи за всеки ден, да им се сменя
   името/описанието и да им се качва снимка. Стойностите тук са само
   стойностите по подразбиране, ако админът още нищо не е записал.
   Ключовете съвпадат с Date.getDay() (0 = неделя ... 6 = събота). */
const DEFAULT_WEEKLY_SOUP_SCHEDULE = {
  1: [ // понеделник
    { name:"Крем супа от спанак",        desc:"Кадифена крем супа от пресен спанак.", photo:"" },
    { name:"Крем супа от червена леща",  desc:"Гъста, ароматна супа от червена леща.", photo:"" },
  ],
  2: [ // вторник
    { name:"Крем супа от броколи",       desc:"С настъргано пармезаново сирене.", photo:"" },
    { name:"Крем супа от картоф",        desc:"Кремообразна, с копър и капка масло.", photo:"" },
  ],
  3: [ // сряда
    { name:"Крем супа от грах",          desc:"Свеж грах, лека и ароматна.", photo:"" },
    { name:"Крем супа от моркови",       desc:"Моркови с джинджифил и портокал.", photo:"" },
  ],
  4: [ // четвъртък
    { name:"Крем супа от червена леща",  desc:"Гъста, ароматна супа от червена леща.", photo:"" },
    { name:"Крем супа от картоф",        desc:"Кремообразна, с копър и капка масло.", photo:"" },
  ],
  5: [ // петък
    { name:"Крем супа от тиквички",      desc:"Лека лятна крем супа от тиквички.", photo:"" },
    { name:"Крем супа от спанак",        desc:"Кадифена крем супа от пресен спанак.", photo:"" },
  ],
  6: [ // събота
    { name:"Крем супа от картоф",        desc:"Кремообразна, с копър и капка масло.", photo:"" },
  ],
  0: [ // неделя
    { name:"Крем супа от броколи",       desc:"С настъргано пармезаново сирене.", photo:"" },
  ],
};

const SOUP_SCHEDULE_KEY = "vitamina_soup_schedule_v1";

/* Чете разписанието от localStorage (записано от админ панела); ако
   още няма запазено, връща стойностите по подразбиране отгоре. Липсващи
   дни в записаното разписание се допълват от подразбиращите се. */
function getWeeklySoupSchedule(){
  try{
    const raw = localStorage.getItem(SOUP_SCHEDULE_KEY);
    if(!raw) return DEFAULT_WEEKLY_SOUP_SCHEDULE;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_WEEKLY_SOUP_SCHEDULE, ...parsed };
  }catch(e){ return DEFAULT_WEEKLY_SOUP_SCHEDULE; }
}
function getSoupsForDay(dayIdx){
  const schedule = getWeeklySoupSchedule();
  return schedule[dayIdx] || [];
}
function getTodaysSoups(){ return getSoupsForDay(getToday()); }
function getToday(){ return new Date().getDay(); }
function getTodayName(){
  const names = ["неделя","понеделник","вторник","сряда","четвъртък","петък","събота"];
  return names[getToday()];
}
function getTodayDateString(){
  return new Date().toLocaleDateString("bg-BG", { day:"numeric", month:"long" });
}

/* Цени (лева — виж бележката горе за EUR_RATE/fmt): супа 2.20 €,
   таратор 2.80 €, добавка ядки към таратора 0.60 €. */
const SOUP_PRICE = 4.30;
const TARATOR_PRICE = 5.48;
const TARATOR_NUTS_ADDON_PRICE = 1.17;
const MAX_INGREDIENT_QTY = 4;

/* ================= ВАЛУТА ================= */
/* Официалният фиксиран курс лев/евро (1 EUR = 1.95583 BGN), по който
   България въведе еврото. Всички цени по-горе са записани в лева, но
   на сайта винаги се показват в евро — просто чрез тази функция. */
const EUR_RATE = 1.95583;
function toEUR(bgn){ return Number(bgn) / EUR_RATE; }
function fmt(n){ return toEUR(n).toFixed(2); }
/* Закръглява единичната цена на съставка до евроцент ПРЕДИ да се умножи
   по количество — иначе умножаването на цяла сума в лева и закръгляне
   само накрая кара цената да "скача" с ±1 цент при 3-та/4-та добавена
   бройка от една и съща съставка (виж конструктора "Направи си сам"). */
function unitEUR(bgn){ return Math.round((Number(bgn) / EUR_RATE) * 100) / 100; }