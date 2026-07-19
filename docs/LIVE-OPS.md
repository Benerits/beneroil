# BenelOil — Live Ops: WebSocket, Admin Actions & Push Automations

> **For future maintainers & AI agents.** How to reach live players in real time
> (balance, notifications, hot-fixes, forced reload) and the temporary signup-push
> automation. All live-ops run **inside the isolated BenelOil container** (same Node
> process + port, no extra infra). Written 2026-07-19.

## 1. WebSocket live channel (isolated, in-container)

**Server** (`server/index.js`): a `ws` `WebSocketServer({ noServer:true })` attached to the
existing `http` server via `server.on('upgrade')`. Path `/ws?token=<authToken>`. Token is
verified with `verifyToken` (HMAC email|exp); the email is resolved to a `benzinlik_player.id`
and the socket is stored in `liveSockets: Map<userId, Set<ws>>`. 30s ping/pong heartbeat drops
dead sockets. `pushToUser(id,msg)` / `broadcastAll(msg)` fan out JSON frames.

**Client** (`src/main.ts`, `connectLive()`): after login it opens `wss://<host>/ws?token=…`,
auto-reconnects with 1–6s backoff, and handles message types:
- `balance` → `state.money = money` + toast (no reload; balance already persisted server-side).
- `notify` → in-game toast (+ Web Notification if permission granted).
- `patch` → `applyLivePatch` applies a **whitelisted** partial: `money`, `tanks.{fuel}`,
  `orders.{fuel}` (cleared), then `persist()`. This is the hot-fix channel.
- `reload` → `location.reload()` after 0.8s.

Disabled in `?full`/`?promo` and while `cloudBlocked`.

## 2. Admin control endpoints (Bearer `VS_API_KEY`)

Reach a single player:
```
POST /vs/v1/users/:id/live
  {kind:"balance", op:"set|add|subtract", amount:N, toast?:"…"}  → DB write + live push
  {kind:"notify",  title:"BenelOil", body:"…"}                   → toast + logs to beneloil_notification
  {kind:"patch",   patch:{money?,tanks?,orders?}}                → live hot-fix (no DB write)
  {kind:"hotfix-fuel"}                                           → fill all tanks to cap + clear orders (DB + live)
  {kind:"reload"}                                                → force client reload
```
Everyone at once:
```
POST /vs/v1/broadcast {kind:"notify", title, body} | {kind:"reload"}
```
Read:
```
GET /vs/v1/notifications  → last 100 sent notifications (feeds the "Push Log" panel page)
GET /vs/v1/live-status     → { onlineSockets: N }  (truly-connected socket count)
```
Response `{data:{... , live:N}}` — `live` = how many of the player's sockets received it (0 if
they're offline; the DB write for balance/hotfix still applies, so it takes effect on next load).

## 3. Admin panel (admin.benerits.com/apps/beneloil)

- **User profile** (`_user-profile` custom page, `kind=user_profile`): a `record` (stats) block +
  an `actions` block with live buttons — ⚡ +50k (canlı), 📢 Teşekkür bildirimi, 🔧 Yakıt hot-fix,
  🔄 Zorla reload — plus DB balance + ban/unban. Edit via MCP
  `set_custom_page_blocks page:"_user-profile"`. Action `body` is flat `[{key,value}]`; nested
  payloads (like `patch`) aren't expressible there, which is why `hotfix-fuel` is a server-side
  kind that needs no body.
- **Push Log** (`push-log` custom page): datatable of `/vs/v1/notifications`. (`notifications` is a
  reserved slug — do not reuse it.)

## 4. Hot-fix playbook (replaces the old batch-restore dance)

Stuck-order / bad-state bugs no longer need a mass `rawsave`→`restore` script. Once identified:
- Single player: `POST /vs/v1/users/:id/live {kind:"hotfix-fuel"}` (or a targeted `patch`).
- Ship a client fix, then `POST /vs/v1/broadcast {kind:"reload"}` to push everyone onto it live.
The old admin recovery endpoints still exist: `/vs/v1/users/:id/{rawsave,restore,detail,balance,ban}`.

## 5. Signup push automation (TEMPORARY — via sortubes APNs) — TODO / REMINDER

**Status: planned, not yet wired at time of writing.** Goal: when a new BenelOil player registers,
send an APNs push ("BenelOil · +1 oyuncu geldi 🎉") to the team's phones. Decision: **broadcast to
ALL sortubes devices** (only the test/admin team has sortubes installed, so blast-to-all is fine).

Mechanism (reuse, don't rebuild): the **sortubes** game backend `tubes-api`
(github.com/Benerits/tubes-api, Dokploy app id `5HjtRff6hzvWdla1GDm46`,
`tubes-api.benerits.com`) already has full APNs push:
- `lib/notify.ts` — APNs HTTP/2 token auth (env `APNS_P8_B64/KEY_ID/TEAM_ID/TOPIC=com.benerits.sorttubes/PRODUCTION`).
- `POST /vs/v1/notifications/send {segment:{type:"all"}, title, body}` — fans out to all device tokens
  in `arrower_push_token`. (Auth: tubes-api's own operator/VS guard — see `lib/http.ts guarded`.)
- Device tokens are registered by the sortubes iOS app via `POST /ingest/push-token {gcId, token}`.

**Wiring plan:** in BenelOil `server/index.js` register handler, after a successful signup,
fire-and-forget a POST to `https://tubes-api.benerits.com/vs/v1/notifications/send` with
`{segment:{type:"all"}, title:"BenelOil", body:"+1 oyuncu geldi 🎉 (toplam N)"}` using tubes-api's
auth. Keep it non-blocking and swallow errors (must never affect signup). **This is a temporary
cross-product bridge** — revisit and give BenelOil its own APNs topic before iOS launch, then remove
the tubes-api dependency.

> ⏰ REMINDER for whoever reads this: this signup→sortubes-APNs bridge is a stopgap. When BenelOil
> ships its own push (its own bundle id / APNs key), cut this over and delete the tubes-api call.
