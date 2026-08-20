extends Node

## Oyun durumunun TEK otoritesi — web sürümündeki src/state.ts karşılığı.
## Sahneler durumu OKUR, mutasyonu buraya delege eder. Para/itibar state'ini
## sahnelere dağıtmak web sürümünde senkron hatalarının kaynağıydı.
##
## Autoload adı: Game (bkz. project.godot [autoload]).

signal cash_changed(cash: float)
signal day_advanced(day: int)
signal pump_built(count: int)
signal ev_built(count: int)

const DEFAULT_SEED := 20260730

var cash: float = 0.0
var day: int = 1
var pumps: int = 1
var ev_chargers: int = 0
var battery_level: int = 0
var pompaci: int = 0
var ev_attendants: int = 0

## Tohumlu üreteç: sim testleri ancak böyle tekrarlanabilir.
## Global randi()/randf() KULLANMA.
var rng := RandomNumberGenerator.new()

var _day_t: float = 0.0

func _ready() -> void:
	new_game()

## _ready'den ayrı tutuldu: SceneTree tabanlı headless testlerde autoload
## yüklenmediği için node elle new() edilip bu çağrılır.
func new_game(seed_value: int = DEFAULT_SEED) -> void:
	rng.seed = seed_value
	cash = EconData.start_money()
	day = 1
	pumps = 1
	ev_chargers = 0
	battery_level = 0
	pompaci = 0
	ev_attendants = 0
	_day_t = 0.0

func _process(delta: float) -> void:
	tick(delta)

## Gün döngüsü delta tabanlı (gün = 160 sn). Kare sayısına bağlanırsa
## FPS değişimi ekonomi dengesini kaydırır.
func tick(delta: float) -> void:
	var cycle := EconData.day_cycle_sec()
	if cycle <= 0.0:
		return
	_day_t += delta
	while _day_t >= cycle:
		_day_t -= cycle
		_advance_day()

## Günün ne kadarı geçti (0..1) — gündüz/gece ışığı buradan sürülür.
func day_progress() -> float:
	var cycle := EconData.day_cycle_sec()
	return 0.0 if cycle <= 0.0 else _day_t / cycle

# --- Para ---

func add_cash(amount: float) -> void:
	cash += amount
	cash_changed.emit(cash)

func can_afford(amount: float) -> bool:
	return cash >= amount

## Yakıt satışı. Kâr = litre × marj; fiyat/maliyet tek kaynaktan (EconData).
func sell_fuel(fuel: String, litres: float) -> float:
	var profit := litres * EconData.fuel_margin(fuel)
	add_cash(profit)
	return profit

# --- İnşaat ---

func next_pump_cost() -> float:
	return EconData.pump_cost(pumps)

func build_pump() -> bool:
	var price := next_pump_cost()
	if price < 0.0 or not can_afford(price):
		return false
	add_cash(-price)
	pumps += 1
	pump_built.emit(pumps)
	return true

func next_ev_cost() -> float:
	return EconData.ev_cost(ev_chargers)

func build_ev_charger() -> bool:
	var price := next_ev_cost()
	if price < 0.0 or not can_afford(price):
		return false
	add_cash(-price)
	ev_chargers += 1
	ev_built.emit(ev_chargers)
	return true

# --- Gider ---

## Günlük yovmiye: her oyun günü kasadan çıkar.
func daily_wages() -> float:
	return pompaci * EconData.wage("pompaci") \
		+ ev_attendants * EconData.wage("ev_attendant")

## Tesis değeri — web'deki value() hesabıyla aynı: kademe tablolarının toplamı.
func station_value() -> float:
	return EconData.prefix_sum("pump_costs", pumps) \
		+ EconData.prefix_sum("ev_costs", ev_chargers) \
		+ EconData.prefix_sum("battery_costs", battery_level)

func _advance_day() -> void:
	day += 1
	var wages := daily_wages()
	if wages > 0.0:
		add_cash(-wages)
	day_advanced.emit(day)
