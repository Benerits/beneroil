extends SceneTree

## Müşteri döngüsü duman testi: CustomerSim (saf mantık) + Game (para akışı).
## Sahne/görsel yüklenmez — SceneTree testinde autoload'lar yok, bu yüzden
## mantık katmanı bilinçli olarak node'dan bağımsız tutuldu.
##
## Koşum: "$GODOT" --headless --path . --script res://tests/sim_smoke.gd

var _fails := 0

func _init() -> void:
	print("— müşteri döngüsü —")
	_check_spawn()
	_check_fill()
	_check_sale()
	_check_determinism()
	print("SONUÇ: %d başarısız" % _fails)
	quit(1 if _fails > 0 else 0)

func _rng(seed_value: int) -> RandomNumberGenerator:
	var r := RandomNumberGenerator.new()
	r.seed = seed_value
	return r

func _check_spawn() -> void:
	var c := CustomerSim.spawn(_rng(1))
	_ok(c.fuel in CustomerSim.FUELS, "yakıt tipi geçerli (%s)" % c.fuel)
	_ok(c.wanted_litres >= 20.0 and c.wanted_litres <= 60.0,
		"talep 20-60 L arasında (%d L)" % int(c.wanted_litres))
	_ok(c.state == CustomerSim.State.ARRIVING, "başlangıç durumu ARRIVING")

func _check_fill() -> void:
	var c := CustomerSim.spawn(_rng(7))
	c.wanted_litres = 42.0
	c.state = CustomerSim.State.FUELING

	# FILL_RATE 7 L/sn (web ile aynı) → 42 L tam 6 saniye
	var t := 0.0
	while c.state == CustomerSim.State.FUELING and t < 30.0:
		c.pump(0.1, 7.0)
		t += 0.1
	_eq(c.filled_litres, 42.0, "42 L dolum tamamlandı")
	_ok(absf(t - 6.0) < 0.25, "7 L/sn ile ~6 sn sürdü (ölçülen %.1f sn)" % t)
	_ok(c.state == CustomerSim.State.PAYING, "dolum bitince durum PAYING")

	# Talebi aşan dolum imkânsız olmalı (web'deki fulleme exploit'inin panzehiri)
	c.state = CustomerSim.State.FUELING
	c.pump(5.0, 7.0)
	_eq(c.filled_litres, 42.0, "fazla dolum YOK — talep aşılmıyor")

func _check_sale() -> void:
	var g: Node = load("res://scripts/game.gd").new()
	g.new_game()
	var before: float = g.cash
	var profit: float = g.sell_fuel("benzin", 42.0)
	_eq(profit, 147.0, "42 L benzin → ₺147 kâr (42 × 3.5)")
	_eq(g.cash, before + 147.0, "kasa kâr kadar arttı")
	g.free()

## Aynı tohum → aynı müşteri dizisi. Tüm sim testleri buna dayanıyor.
func _check_determinism() -> void:
	var a: Array = []
	var b: Array = []
	var r1 := _rng(42)
	var r2 := _rng(42)
	for i in 8:
		var c1 := CustomerSim.spawn(r1)
		var c2 := CustomerSim.spawn(r2)
		a.append("%s:%d" % [c1.fuel, int(c1.wanted_litres)])
		b.append("%s:%d" % [c2.fuel, int(c2.wanted_litres)])
	_ok(a == b, "aynı tohum → aynı müşteri dizisi (%s...)" % a[0])

# --- yardımcılar ---

func _eq(got: float, want: float, label: String) -> void:
	_ok(is_equal_approx(got, want), "%s  (beklenen %s, gelen %s)" % [label, want, got])

func _ok(cond: bool, label: String) -> void:
	if cond:
		print("  PASS  ", label)
	else:
		print("  FAIL  ", label)
		_fails += 1
