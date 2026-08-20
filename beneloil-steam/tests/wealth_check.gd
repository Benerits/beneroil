extends SceneTree

## Ekonomi PARİTE testi: Godot tablolarının web sürümüyle (../src/state.ts)
## birebir aynı olduğunu doğrular.
##
## Beklenen sayılar BİLİNÇLİ olarak burada elle yazılı — economy.json'dan
## okunsa test kendi kendini doğrular, hiçbir kayma yakalanmazdı.
##
## Koşum:
##   "$GODOT" --headless --path . --script res://tests/wealth_check.gd

var _fails := 0

func _init() -> void:
	print("— ekonomi paritesi (kaynak gerçeği: web src/state.ts) —")
	_check_basics()
	_check_fuel()
	_check_unit_tables()
	_check_staff()
	_check_flow()
	print("SONUÇ: %d başarısız" % _fails)
	quit(1 if _fails > 0 else 0)

func _check_basics() -> void:
	_eq(EconData.start_money(), 5000.0, "başlangıç parası ₺5000")
	_eq(EconData.day_cycle_sec(), 160.0, "gün döngüsü 160 sn")

func _check_fuel() -> void:
	_eq(EconData.fuel_price("benzin"), 10.0, "benzin fiyatı ₺10")
	_eq(EconData.fuel_cost("benzin"), 6.5, "benzin alım maliyeti ₺6.5")
	_eq(EconData.fuel_margin("benzin"), 3.5, "benzin marjı ₺3.5/L")
	_eq(EconData.fuel_margin("dizel"), 3.0, "dizel marjı ₺3.0/L")
	_eq(EconData.fuel_margin("lpg"), 2.0, "lpg marjı ₺2.0/L")

func _check_unit_tables() -> void:
	var pumps: Array = EconData.arr("pump_costs")
	_ok(pumps.size() == 14, "pompa tablosu 14 kademe (MAX_PUMPS ile aynı)")
	_eq(EconData.num("max_pumps"), 14.0, "max_pumps = 14")
	_eq(EconData.pump_cost(1), 5000.0, "2. pompa ₺5.000")
	_eq(EconData.pump_cost(13), 110000.0, "14. pompa ₺110.000")
	_eq(EconData.pump_cost(14), -1.0, "tavanda pompa satın alınamaz (-1)")

	var ev: Array = EconData.arr("ev_costs")
	_ok(ev.size() == 12, "EV tablosu 12 kademe (MAX_EV ile aynı)")
	_eq(EconData.num("max_ev"), 12.0, "max_ev = 12")
	_eq(EconData.ev_cost(0), 6000.0, "1. EV şarj ₺6.000")
	_eq(EconData.ev_cost(11), 82000.0, "12. EV şarj ₺82.000")
	_eq(EconData.ev_cost(12), -1.0, "tavanda EV satın alınamaz (-1)")

	# JSON sayıları float olarak gelir; Array == Array int'lerle karşılaştırılamaz.
	_arr_eq("tank_capacity", [800.0, 1500.0, 3000.0, 5000.0], "tank kapasiteleri 800/1500/3000/5000")
	_arr_eq("tank_add_costs", [0.0, 6000.0, 12000.0, 20000.0], "ek tank maliyetleri 0/6k/12k/20k")
	_eq(EconData.num("ev_price_per_kwh"), 8.0, "EV satış ₺8/kWh")
	_eq(EconData.num("grid_cost_per_kwh"), 3.5, "şebeke maliyeti ₺3.5/kWh")

func _check_staff() -> void:
	_eq(EconData.wage("pompaci"), 120.0, "pompacı günlük yovmiye ₺120")
	_eq(EconData.wage("ev_attendant"), 150.0, "şarjcı günlük yovmiye ₺150")
	_eq(EconData.hire_cost("pompaci"), 800.0, "pompacı işe alma ₺800")
	_eq(EconData.manager_wage(3), 1200.0, "müdür Sv.3 yovmiye ₺1.200")

## Durum akışı: Game autoload'u SceneTree testinde yüklenmez, elle kurulur.
func _check_flow() -> void:
	var g: Node = load("res://scripts/game.gd").new()
	g.new_game()

	_eq(g.cash, 5000.0, "yeni oyun kasası ₺5000")
	_ok(g.pumps == 1, "yeni oyun 1 pompayla başlar")

	_eq(g.sell_fuel("benzin", 100.0), 350.0, "100 L benzin → ₺350 kâr")
	_eq(g.cash, 5350.0, "satış sonrası kasa ₺5.350")

	_ok(g.build_pump(), "₺5.350 ile 2. pompa (₺5.000) alınabilir")
	_eq(g.cash, 350.0, "pompa sonrası kasa ₺350")
	_ok(g.pumps == 2, "pompa sayısı 2")
	_ok(not g.build_pump(), "₺350 ile 3. pompa (₺8.000) ALINAMAZ")

	_eq(g.station_value(), 5000.0, "tesis değeri = ödenen kademe toplamı ₺5.000")

	g.pompaci = 2
	_eq(g.daily_wages(), 240.0, "2 pompacı → günlük ₺240 yovmiye")

	# Gün döngüsü delta tabanlı: 160 sn = tam bir gün, yovmiye bir kez kesilir.
	g.tick(160.0)
	_ok(g.day == 2, "160 sn sonra gün 2")
	_eq(g.cash, 110.0, "gün geçişinde yovmiye kesildi (₺350 − ₺240)")

	g.free()

# --- yardımcılar ---

func _arr_eq(key: String, want: Array, label: String) -> void:
	var got: Array = EconData.arr(key)
	if got.size() != want.size():
		_ok(false, "%s  (uzunluk %d ≠ %d)" % [label, got.size(), want.size()])
		return
	for i in want.size():
		if not is_equal_approx(float(got[i]), float(want[i])):
			_ok(false, "%s  (index %d: beklenen %s, gelen %s)" % [label, i, want[i], got[i]])
			return
	_ok(true, label)

func _eq(got: float, want: float, label: String) -> void:
	_ok(is_equal_approx(got, want), "%s  (beklenen %s, gelen %s)" % [label, want, got])

func _ok(cond: bool, label: String) -> void:
	if cond:
		print("  PASS  ", label)
	else:
		print("  FAIL  ", label)
		_fails += 1
