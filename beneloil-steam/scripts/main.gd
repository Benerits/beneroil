extends Node3D

## Sahne kabuğu: HUD, giriş, gündüz-gece ışığı ve pompa görünürlüğü.
## Ekonomi kararı burada YOK — hepsi Game autoload'unda.

const PUMP_NODES := ["Pump1", "Pump2", "Pump3", "Pump4"]
const DAY_END := 0.62          # günün bu oranı gündüz (web: ~90sn / 160sn)
const SUN_DAY_ENERGY := 1.15
const SUN_NIGHT_ENERGY := 0.05
const FLASH_SEC := 2.5

@onready var _hud: Label = $HUD/Info
@onready var _sun: DirectionalLight3D = $Sun
@onready var _station: Node3D = $Station
@onready var _traffic: Node3D = $Traffic

var _litres_total := 0.0
var _sales := 0
var _flash := ""
var _flash_t := 0.0

## Headless doğrulama kancası: BENELOIL_SIM_SECONDS kadar OYUN saniyesi
## simüle edilir, özet basılır, çıkılır. BENELOIL_TIME_SCALE ile hızlandırılır
## (varsayılan 20× — 160 sn'lik bir gün ~8 sn duvar saatinde döner).
var _sim_target := 0.0
var _sim_t := 0.0

## BENELOIL_SHOT=/yol/kare.png verilirse oyun kendi framebuffer'ını PNG'ye
## yazıp çıkar. Masaüstü ekran görüntüsüne göre daha temiz kanıt: sadece
## oyun karesi, pencere yönetimiyle uğraşmadan.
var _shot_path := ""
var _shot_delay := 0.0

@onready var _cam: Camera3D = $Camera3D

func _ready() -> void:
	_setup_sim_harness()
	_setup_shot_hook()
	Game.cash_changed.connect(_on_cash_changed)
	Game.day_advanced.connect(_on_day_advanced)
	Game.pump_built.connect(_on_pump_built)
	_traffic.sale.connect(_on_sale)
	_apply_pump_visibility()
	_render()
	print("[main] açılış — kasa=₺%d gün=%d pompa=%d" % [int(Game.cash), Game.day, Game.pumps])

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_accept"):
		_try_build_pump()

func _process(delta: float) -> void:
	_update_sun()
	if not _shot_path.is_empty():
		_shot_delay -= delta
		if _shot_delay <= 0.0:
			var path := _shot_path
			_shot_path = ""
			_capture(path)
			return
	if _sim_target > 0.0:
		_sim_t += delta
		if _sim_t >= _sim_target:
			_print_sim_summary()
			get_tree().quit(0)
			return
	if _flash_t > 0.0:
		_flash_t -= delta
		if _flash_t <= 0.0:
			_flash = ""
			_render()

# --- oynanış ---

func _try_build_pump() -> void:
	var price := Game.next_pump_cost()
	if Game.build_pump():
		_flash_msg("Pompa kuruldu → %d pompa (₺%d ödendi)" % [Game.pumps, int(price)])
	elif price < 0.0:
		_flash_msg("Pompa tavanına ulaşıldı")
	else:
		_flash_msg("Kasa yetersiz — gereken ₺%d" % int(price))

## Sadece satın alınmış pompalar sahnede görünür: yatırımın görsel karşılığı.
func _apply_pump_visibility() -> void:
	for i in PUMP_NODES.size():
		var n := _station.get_node_or_null(PUMP_NODES[i]) as Node3D
		if n != null:
			n.visible = i < Game.pumps

# --- gündüz / gece ---

## Güneş gün boyunca doğudan batıya yay çizer, gece söner.
## Transform'u motora hesaplatıyoruz — elle matris yazmak .tscn'de
## transpoze tuzağına düşürüyor (bkz. godot-gdscript skill'i).
func _update_sun() -> void:
	var t := Game.day_progress()
	if t >= DAY_END:
		_sun.light_energy = SUN_NIGHT_ENERGY
		return
	var k := t / DAY_END                       # 0 = şafak, 1 = akşam
	var angle := PI * k
	var pos := Vector3(cos(angle) * 22.0, sin(angle) * 20.0 + 2.0, 8.0)
	_sun.transform = Transform3D(Basis(), pos).looking_at(Vector3.ZERO, Vector3.UP)
	_sun.light_energy = SUN_DAY_ENERGY * clampf(sin(angle) * 1.6, 0.12, 1.0)

# --- sinyal karşılıkları ---

func _on_cash_changed(_cash: float) -> void:
	_render()

func _on_day_advanced(day: int) -> void:
	print("[main] gün %d — kasa=₺%d, satılan %d L" % [day, int(Game.cash), int(_litres_total)])
	_flash_msg("Gün %d başladı" % day)

func _on_pump_built(_count: int) -> void:
	_apply_pump_visibility()
	_render()

func _on_sale(_amount: float, litres: float) -> void:
	_litres_total += litres
	_sales += 1
	_render()

# --- headless sim kancası ---

func _setup_sim_harness() -> void:
	var secs := OS.get_environment("BENELOIL_SIM_SECONDS")
	if secs.is_empty():
		return
	_sim_target = float(secs)
	var scale := OS.get_environment("BENELOIL_TIME_SCALE")
	Engine.time_scale = float(scale) if not scale.is_empty() else 20.0
	# Yatırım→gelir eğrisini ölçmek için başlangıç pompa sayısı verilebilir.
	var pumps := OS.get_environment("BENELOIL_SIM_PUMPS")
	if not pumps.is_empty():
		Game.pumps = clampi(int(pumps), 1, int(EconData.num("max_pumps")))
	print("[sim] %d oyun saniyesi, %.0f× hız" % [int(_sim_target), Engine.time_scale])

func _setup_shot_hook() -> void:
	_shot_path = OS.get_environment("BENELOIL_SHOT")
	if _shot_path.is_empty():
		return
	var after := OS.get_environment("BENELOIL_SHOT_AFTER")
	_shot_delay = float(after) if not after.is_empty() else 6.0

func _capture(path: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(path)
	print("[shot] %s → %s" % [path, "ok" if err == OK else "HATA %d" % err])
	get_tree().quit(0)

func _print_sim_summary() -> void:
	print("[sim] kamera: %s  size=%.1f  zoom=%.2f  açı=%d  yükseliş=%.1f°" % [
		"ortografik" if _cam.projection == Camera3D.PROJECTION_ORTHOGONAL else "PERSPEKTİF",
		_cam.size, _cam.zoom, _cam.angle_index, _cam.elevation_degrees()])
	var earned := Game.cash - EconData.start_money()
	print("[sim] SONUÇ  gün=%d  kasa=₺%d  net=%+d  satış=%d  litre=%d  pompa=%d" % [
		Game.day, int(Game.cash), int(earned), _sales, int(_litres_total), Game.pumps])
	if _sales > 0:
		# Kâr/litre yakıt karmasına göre değişir (3.5 / 3.0 / 2.0) — ölçülen
		# ortalamayı basıyoruz, sabit varsaymıyoruz.
		print("[sim] ortalama: %.1f L/satış  ·  ₺%.2f kâr/litre" % [
			_litres_total / float(_sales), earned_per_litre()])

func earned_per_litre() -> float:
	var earned := Game.cash - EconData.start_money()
	return 0.0 if _litres_total <= 0.0 else earned / _litres_total

# --- HUD ---

func _flash_msg(msg: String) -> void:
	_flash = msg
	_flash_t = FLASH_SEC
	_render()

func _render() -> void:
	var next := Game.next_pump_cost()
	var next_txt := "tavan" if next < 0.0 else "₺%d" % int(next)
	var lines := [
		"₺%d   ·   Gün %d   ·   %d/%d pompa" % [
			int(Game.cash), Game.day, Game.pumps, int(EconData.num("max_pumps"))],
		"Satılan %d L   ·   Sıradaki pompa %s   ·   [SPACE] pompa al" % [
			int(_litres_total), next_txt],
	]
	if _flash != "":
		lines.append(_flash)
	_hud.text = "\n".join(lines)
