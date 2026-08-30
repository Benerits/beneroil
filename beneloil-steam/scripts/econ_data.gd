class_name EconData
extends RefCounted

## Ekonomi tablolarının TEK okuma noktası.
##
## Tablolar res://data/economy.json içinde; kaynak gerçeği web sürümündeki
## ../src/state.ts. Sayıları burada veya JSON'da web'den bağımsız DEĞİŞTİRME —
## bkz. tycoon-economy ve godot-port-web skill'leri.
##
## API bilinçli olarak statik: SceneTree tabanlı headless testlerde autoload'lar
## yüklenmediği için veri katmanı autoload'a bağımlı olmamalı.

const DATA_PATH := "res://data/economy.json"

static var _tables: Dictionary = {}

static func tables() -> Dictionary:
	if _tables.is_empty():
		var f := FileAccess.open(DATA_PATH, FileAccess.READ)
		if f == null:
			push_error("economy.json açılamadı: %s" % DATA_PATH)
			return {}
		var parsed: Variant = JSON.parse_string(f.get_as_text())
		if typeof(parsed) != TYPE_DICTIONARY:
			push_error("economy.json geçersiz JSON")
			return {}
		_tables = parsed
	return _tables

static func num(key: String) -> float:
	return float(tables().get(key, 0.0))

static func arr(key: String) -> Array:
	var v: Variant = tables().get(key, [])
	return v as Array

## Tablonun ilk n kademesinin toplamı — web'deki sum(TABLE, n) muadili.
static func prefix_sum(key: String, n: int) -> float:
	var t: Array = arr(key)
	var s := 0.0
	for i in mini(n, t.size()):
		s += float(t[i])
	return s

## Kademe tablosundan sıradaki fiyat. Tavana gelindiyse -1.0 (satın alınamaz).
static func step_cost(key: String, owned: int) -> float:
	var t: Array = arr(key)
	if owned < 0 or owned >= t.size():
		return -1.0
	return float(t[owned])

# --- Başlangıç / zaman ---

static func start_money() -> float:
	return num("start_money")

static func day_cycle_sec() -> float:
	return num("day_cycle_sec")

# --- Yakıt ---

static func _fuel(fuel: String) -> Dictionary:
	var fuels: Dictionary = tables().get("fuels", {})
	return fuels.get(fuel, {})

static func fuel_price(fuel: String) -> float:
	return float(_fuel(fuel).get("price", 0.0))

static func fuel_cost(fuel: String) -> float:
	return float(_fuel(fuel).get("cost", 0.0))

## Litre başı marj (benzin 3.5 / dizel 3.0 / lpg 2.0 — web ile birebir).
static func fuel_margin(fuel: String) -> float:
	return fuel_price(fuel) - fuel_cost(fuel)

static func fuel_types() -> Array:
	var fuels: Dictionary = tables().get("fuels", {})
	return fuels.keys()

# --- Üniteler ---

static func pump_cost(owned: int) -> float:
	if owned >= int(num("max_pumps")):
		return -1.0
	return step_cost("pump_costs", owned)

static func ev_cost(owned: int) -> float:
	if owned >= int(num("max_ev")):
		return -1.0
	return step_cost("ev_costs", owned)

static func battery_cost(level: int) -> float:
	return step_cost("battery_costs", level)

# --- Personel ---

static func wage(role: String) -> float:
	var wages: Dictionary = tables().get("wages", {})
	return float(wages.get(role, 0.0))

static func manager_wage(level: int) -> float:
	var wages: Dictionary = tables().get("wages", {})
	var mgr: Array = wages.get("manager", []) as Array
	if level < 0 or level >= mgr.size():
		return 0.0
	return float(mgr[level])

static func hire_cost(role: String) -> float:
	var hire: Dictionary = tables().get("hire", {})
	return float(hire.get(role, 0.0))
