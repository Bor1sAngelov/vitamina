# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Static, no-build website for Витамина (Vitamina), a salad bar in Vratsa, Bulgaria. Plain HTML/CSS/JS — no
package.json, no bundler, no test runner. To work on it, just open the `.html` files in a browser or serve
the folder with any static file server (e.g. `npx serve` / VS Code Live Server); there is no build/lint/test
command to run.

## Pages and shared includes

`index.html`, `menu.html`, `cart.html`, `jobs.html`, `contact.html`, `admin.html` all share the same
header/footer markup and load the same three scripts in the same order:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/supabase.min.js"></script>
<script src="js/data.js"></script>
<script src="js/script.js"></script>
```

- **`js/data.js`** — pure data/config, no DOM logic: `MENU_DATA` (full menu with prices/weights/nutrition),
  `BUILDERS`/`DIY_INGREDIENTS`/`DIY_DRESSINGS` ("направи си сам" builder for salad/bowl/burger),
  `WORKING_HOURS` + ordering-window/pickup-slot helpers, `SOUP_PRESETS`/weekly soup rotation,
  `CONTACT_INFO`, Supabase credentials (`SUPABASE_URL`/`SUPABASE_ANON_KEY`), and the BGN→EUR conversion
  (`EUR_RATE`, `toEUR()`, `fmt()`). **Menu prices are authored in BGN here and always displayed in EUR** via
  `fmt()` — never hardcode a EUR price, edit the BGN number and let conversion handle the rest.
- **`js/script.js`** — every page's behavior lives in this one file. A single `DOMContentLoaded` handler
  calls every `initX()` (`initNav`, `initHome`, `initMenu`, `initCart`, `initJobs`, `initAdmin`, `initReveal`,
  `initSupabaseSync`, ...) on **every** page; each `initX()` immediately returns if the DOM elements it needs
  aren't present (e.g. `initCart()` no-ops unless `#cartList` exists). When adding a page-specific feature,
  follow this pattern: add another guarded `initX()` and register it in the `DOMContentLoaded` listener at
  the bottom of the file, rather than splitting into a per-page script.
- **`css/style.css`** — single stylesheet for the whole site, organized into `/* ===== */` banner-commented
  sections (header/nav, hero, menu page, cart page, admin, DIY builder, note modal, ordering-paused overlay,
  etc.) rather than per-component files.

## State & persistence

Everything is client-side. `localStorage` holds: cart (`vitamina_cart_v1`), submitted orders
(`vitamina_orders_v1`), job applications (`vitamina_applications_v1`), soup-of-the-day override, the
ordering-paused flag, admin's seen-order ids, and visit counters.

Orders and the ordering-paused flag can *additionally* sync live across devices (phone places an order →
appears instantly on the team's computer) through Supabase, if `SUPABASE_URL`/`SUPABASE_ANON_KEY` in
`js/data.js` are set and the SDK loads — see `initSupabaseSync()`, `pushOrderToVitaminaSystem()`,
`mirrorOrderUpdate/Delete/Clear()`, and the `orders`/`settings` Postgres-changes subscriptions in
`script.js`. If Supabase isn't reachable/configured, everything silently falls back to the plain
`localStorage`-only behavior — job applications are **not** mirrored to Supabase, only orders/settings are.

## Admin panel (`admin.html`)

Gated by a client-side-only password check (`ADMIN_PASSWORD` constant in `script.js`, session flag in
`sessionStorage`) — this is a soft UI gate, not real access control, since the whole site is static and the
password is visible in the shipped JS. The panel manages: incoming orders (confirm/delay/delete, with a
chime + SMS/mailto fallback for notifying customers), job applications, the soup-of-the-day override, an
ordering pause toggle (blocks new orders site-wide via the overlay in `showOrderingPausedOverlay()`), and
visitor stats.

## Content notes

- The top-level Cyrillic-named folders (`Салати/`, `Десерти/`, `Смути/`, `Бургер/`) contain raw photo assets
  staged for future use — menu/gallery cards currently render `.img-placeholder` "снимка предстои" (photo
  coming) placeholders instead of these images, they are not yet wired into any page.
- Site copy and menu content are in Bulgarian; keep new user-facing strings consistent with that.
