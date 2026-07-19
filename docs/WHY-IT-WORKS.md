# BenelOil — Why It Works: Appeal, Dopamine & Retention Teardown

> **For future maintainers & AI agents.** This document explains *why players engage
> with this game* and *what its mechanics actually are*, grounded in the code with
> `file:line` references. Read this before touching game-feel, economy, or onboarding —
> it captures the intent behind systems that look arbitrary in isolation.
> Written 2026-07-19 after the public launch. Numbers are as of that date.

---

## 0. TL;DR — the hallmark ("alâmet-i farika")

**You don't manage a gas station from a spreadsheet — you ARE the pump attendant.**
Almost every tycoon game makes you a detached manager clicking upgrade buttons. BenelOil
puts you *behind the pump*: you personally pick the right nozzle, hold to fill, clean the
windshield, and sprint to the next honking car before their patience runs out. That
embodied, tactile, "can-I-keep-up" labor fantasy — wrapped in a culturally instant premise
(a Turkish *benzinlik*) and a self-marketing 40-second video that shows the exact loop — is
why it converted **31.5% of tweet likes into signups**. The appeal is front-loaded and
real; the retention curve is the weak spot (see §6).

---

## 1. Launch data (the evidence)

- Growth driver: one tweet by @oguzthedev (verified), 2026-07-19 00:02 UTC, 39.7s in-engine
  video. **330 likes · 39 replies.**
- **104 of 106 players signed up *after* the tweet** → the tweet is ~98% of all traffic.
- **Like→signup conversion ≈ 31.5%** (104/330). Typical social-game launch is 5–15%; this
  is exceptional and points to a pre-qualified audience (the video shows the exact loop, so
  clickers already know they want it).
- Retention (the honest part): **~23% reached day 5, ~10 players reached day 15.** ~77% churn
  before day 5. Appeal is front-loaded; mid-game + onboarding leak players (§6).
- Aggregate: 8,177 customers served across all players in the first ~day.

---

## 2. Why players *like* it — the appeal stack

Ordered by importance. Each is grounded in a concrete system.

### 2.1 First-person labor fantasy (THE differentiator)
You physically perform the service, you're not an abstract owner. The micro-loop
(`ui.ts:342-391`, `main.ts:423-535`): click car → read colored demand bubble → **select
nozzle** (wrong nozzle = instant 😡 + −₺300, `main.ts:527-536`) → **hold to fill** at
`FILL_RATE=7 L/s` → land near target for a **tip**, overfill for a **spill penalty**. The
panel closes on Start so the live ₺/L counter runs *on the car itself* (`ui.ts:271`) — your
attention stays on the world, not a menu. This "you're the worker" framing is the hook the
video sells and the thing no competitor in the idle-tycoon space does.

### 2.2 Sub-second, multi-sensory reward on every sale
The single biggest dopamine hit is a **layered** event: green toast + cash chime
(`audio.cash()`) + floating 😍 face that drifts upward + the live counter freezing on the
final number. Every good toast auto-fires the cash chime (`ui.ts:591-595`); satisfaction
emoji maps to score ≥4.5 😍 / ≥3.5 🙂 / ≥2.5 😐 / else 😡 (`main.ts:417`, `cars.ts:370-485`).
All audio is synthesized (no assets) in `src/audio.ts` — cash chime, achievement fanfare
(4-note C-E-G-C), build jingle, generative 100-BPM music.

### 2.3 A skill lever that literally doubles the reward
**Cleaning the windshield doubles the tip** (10%→20%) and boosts satisfaction
(`main.ts:503-508`, effect `cars.ts:379-402`). It's optional, so mastering it *feels* like
skill expression — a classic "the better you play, the bigger the number" dopamine loop.

### 2.4 Constant benign pressure (tension without a stress bar)
Patience clocks are **deliberately invisible** (`cars.ts:476-477`) — you feel urgency
through behavior, not a UI bar. Sources of pressure: patience timeout loses the customer
(−0.2 rep, `main.ts:214-220`), EV **squatters** block chargers until dismissed
(`main.ts:606-617`), wrong-fuel/spill/missing-facility penalties (`main.ts:300-308`),
tank/battery running dry mid-sale. The fun is *yetişememe* — the pleasant panic of barely
keeping up as the station gets busy.

### 2.5 Legible growth that *summons its own demand*
Expansion is visible and self-reinforcing: a bigger sign, more facilities, and higher
reputation all directly raise `entryChance` (`state.ts:360-370`), so **building more
literally makes more cars turn in**. Growth is spatial — your station visibly fills with
pumps, buildings, EV chargers, a nuclear reactor — not just an abstract number going up.

### 2.6 Ownership & creative expression
Name your station (account-bound, sets the browser tab title, `main.ts:1457-1476`); **move
everything** in edit mode with live traffic re-routing (`main.ts:1775-1826`); unlimited
solar/parking/air-water/self-wash (`state.ts:465-506`); an 18-parcel real-estate system;
and a **nuclear SMR** that explodes and wipes your save if neglected (`state.ts:279-287`).
"Benim istasyonum" (my station) ownership drives the build-a-cool-thing motivation.

### 2.7 Zero-friction, in-language, self-marketing
Browser, no install, instant play once past the gate. Auto-detected TR/EN (`i18n.ts:7-13`).
And crucially: **the game plays its own ad** — `?promo=1` is a director-mode reel that
auto-builds the whole progression with captions and a gliding camera (`main.ts:2192-2257`).
The tweet's video is 100% in-engine footage of this mode. The product is its own marketing.

### 2.8 Culturally instant premise
A Turkish *benzinlik* needs zero explanation — everyone has stood at one. The premise is
relatable, mildly charming/absurd, and comprehensible in one sentence, which is exactly why
the video hook works with no tutorial.

---

## 3. The engagement loop (how the systems interlock)

```
 growth (sign/facilities/rep, cheaper prices)
        │  raises entryChance + EV share
        ▼
 more & denser car spawns  ──►  invisible patience clocks + squatters +
        │                        wrong-fuel/spill/missing-facility risk
        │                              │  (constant micro-pressure)
        ▼                              ▼
 fast, clean, facility-complete service ──► tips (2× if windows cleaned) +
        │                                    reputation + daily-quest progress
        └──────────────► raises entryChance again ────────────────┘
```

Nested reward cadences layered on top: per-sale tips (skill), tap-to-collect piggy-banks
(idle, `main.ts:1919-1926`), daily login streak (habit, ₺500→₹2000 cap at 7 days,
`main.ts:1318-1332`), daily 15-customer quest (+₺1000, `main.ts:443-451`), day-end profit
report (session goal, `main.ts:1997-2007`), offline earnings (return hook, 2h cap), rewarded
"MÜŞTERİ PATLAMASI" ad rush (`main.ts:1741-1773`), and random timed promos (variable-ratio
surprise, `state.ts:288-303`).

---

## 4. Economy & progression cheat-sheet (concrete numbers)

- **Start:** ₺5000, rep 3.0, 1 pump, tanks benzin 250 / dizel 150 / lpg 100 L (`state.ts:9,82,90`).
- **Per-sale:** fuel demand ∈ [100,150,200,250,300,400] ₺ (`cars.ts:8,286`); base margin
  benzin 3.5 / dizel 3.0 / lpg 2.0 ₺/L; tip 10% (20% if windows cleaned); spill penalty
  `max(5, spill×3)`; wrong fuel −₺300 (`state.ts:16-17`, `main.ts:488-536`).
- **EV:** demand 20–60 kWh, revenue = kWh × elecPrice (default 8 ₺/kWh); grid cost 3.5 ₺/kWh
  (solar/SMR free) → margin lever (`state.ts:23-24`, `main.ts:580-620`).
- **Costs (fixed arrays, ~linear — no exponential wall):** pump [5k,8k,12k,16k,21k,26k,32k]
  cap 8; sign [1.5k,4k,9k]; tank [3k,7k,15k]; grid [8k,15k]; battery [5k,9k,16k]; EV charger
  [6k…38k] cap 8; solar 9k (∞); diesel gen 4k; **SMR 40k** (`state.ts:27-38`).
- **Tech tree gate:** Grid L1 → Battery L1 → EV charger; SMR needs Grid L2. Building anything
  (except solar) needs an owned + paved parcel (pave = ₺2500).
- **8 achievements** (`state.ts:566-575`): first-10k, rich-100k, five-star (rep≥4.95),
  full-pumps (≥4), electric-age, atomic (SMR), landlord (≥9 parcels), week-one (day≥7).
- **Reputation** 0–5, `addRep((score−3.3)×0.08)`; each point above 3 shifts entryChance ±5%
  (`state.ts:360-370`) — creates an early **downward spiral** for players who make mistakes.
- **Day = 160 real seconds** (~90s day / ~40s night, `main.ts:1957`).

---

## 5. Customer simulation (what makes it feel alive)

- Two lanes: near (can enter) / far (pure through-traffic) — the road always looks busy
  (`cars.ts:888-903`). Spawn every ~1.5–3.3s, cap 18 transit cars.
- Car types: sedan/hatch/suv + trucks (85% dizel, 40% want the reverse-park truck bay) + EVs
  (share scales with chargers, cap 50%). ~40/40/20 benzin/dizel/lpg. 10% want a FULLE
  (₺500–1000 sale). Facility desires rolled per-car: market 35%, coffee 30%, wash 25%, air
  20%, food 18%, toilet 12%, oil 12% (`cars.ts:283-300`).
- **Crowd factor** (`cars.ts:870-897`): when the station is full/approaching-full, new cars
  stop peeling off toward it (down to 5% entry) so the apron doesn't gridlock — this was a
  player-requested fix and keeps the space readable.
- Heavy anti-gridlock + stuck-car recovery/evaporation machinery (`cars.ts:736-840`) keeps
  the sim from visibly locking up — critical for the "living world" feel.
- Everything is **movable** and traffic re-adapts live (dynamic pump/EV/gate/tank slots read
  through callbacks; solids recomputed every frame, `main.ts:2158`).

---

## 6. Where players are LOST (the ~77% pre-day-5 drop) — highest-leverage fixes

The appeal is front-loaded; these are the retention leaks, ranked. **This is the roadmap.**

1. **Account wall before ANY gameplay** (`main.ts:22-74`, `await new Promise(()=>{})` halts the
   engine until login; "misafir modu YOK" line 24). The 31.5% conversion is *capped by* this
   gate — nobody plays before committing an email+password. **Biggest single lever:** allow a
   sandbox / first-customer *before* the gate, or guest→convert, or OAuth/magic-link.
2. **No real onboarding/tutorial** — one welcome toast (`main.ts:1269`); everything else is
   reactive toast spam. Add a 3–4 step interactive tutorial (nozzle → fill → buy pump → order
   tanker).
3. **Punishing early economy / negative-reward onboarding.** ₺5000 + 1 pump; wrong-fuel −₺300
   is 6% of starting cash; missed cars drop rep which gates traffic → **downward spiral**, and
   the low-money "Murphy" multiplier makes breakdowns *more* likely when broke
   (`state.ts:326-332`). Soften early penalties / add a day-1–2 grace period.
4. **Reward-curve cliff.** 2nd pump = ₺5000 (the whole starting balance); the marquee content
   (electric/solar/nuclear the promo promises in 55s) is many sessions away → expectation-vs-
   reality gap → day 2–4 churn.
5. **Day cadence too fast to be a return unit.** A "day" is 160s, so day 5 arrives in ~13 min
   of one sitting; the real return hooks (login streak, daily mission) are weak and decoupled
   from the day counter. Little compounding reason to return *tomorrow*.
6. **Catastrophic wipe, no safety net.** Unmaintained SMR → entire cloud save nulled
   (`main.ts:1988-1993`). Add insurance / non-destructive meltdown / comeback loan.
7. **Thin idle layer.** Only truck-park + self-wash earn offline, capped ~₺600 each, 2h total —
   the genre's core "come back to collected cash" hook is minimal.
8. **Social proof is gate-only & one-directional.** Live player/online counts drive signup FOMO
   (`main.ts:54-66`) but there's no leaderboard/friends/shareable named-station card — the
   naming + customization creativity has no social/viral outlet after signup.

---

## 7. Anti-loss / integrity systems (do not regress these)

- **Server-authoritative save**, no localStorage game state (`auth.ts:43-50`,
  `main.ts:1270-1273`); autosave every 5s + pagehide keepalive.
- **cloudBlocked guard** (`main.ts:702-716,1252-1267`): if the cloud save fails to load, the
  game LOCKS with an overlay instead of starting fresh — a fresh session must never overwrite a
  progressed cloud save. (This was added after a real override incident; see git history and
  the project memory.) Admin `/vs/v1/users/:id/{detail,rawsave,restore,balance,ban}` endpoints
  exist for recovery.
- Server clamps money/rate-limits saves for anti-cheat (`server/index.js`).

---

## 8. Source map (where to look)

- `src/state.ts` — all constants, shop items, achievements, economy, save schema, entryChance.
- `src/main.ts` — game loop, finishSale (488), EV (580), facilities (276-329), daily (1318),
  day cycle (1997), ads/promo (1741, 2192), onboarding gate (22-74), cloud guard (702, 1252).
- `src/cars.ts` — Car/Tanker/CarManager: demand (283-300), patience, crowd factor (870),
  anti-gridlock (736-840), bubbles/faces/window-shine (346-506).
- `src/ui.ts` — service panel, toasts (591), HUD.
- `src/audio.ts` — 100% synthesized SFX + generative music.
- `src/world.ts` — 3D layout, day/night emissive ramp, piggy-bank/warning sprites.
- `promo/PAYLASIM.md` — social kit + URL modes (`?promo=1`/`?full=1`/`?night=1`/`?adstest=1`).
