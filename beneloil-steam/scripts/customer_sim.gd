class_name CustomerSim
extends RefCounted

## Müşterinin SAF mantığı — node, sahne, görsel bağımlılığı yok.
## Bu yüzden headless SceneTree testinden doğrudan kurulabiliyor
## (bkz. tests/sim_smoke.gd). Görsel/hareket customer.gd'de,
## para akışı Game autoload'unda.

enum State { ARRIVING, FUELING, PAYING, LEAVING, DONE }

const FUELS := ["benzin", "dizel", "lpg"]
const MIN_LITRES := 20
const MAX_LITRES := 60

var state: State = State.ARRIVING
var fuel: String = "benzin"
var wanted_litres: float = 0.0
var filled_litres: float = 0.0

## Tohumlu üreteçle üretilir — sim testleri tekrarlanabilir kalsın.
static func spawn(rng: RandomNumberGenerator) -> CustomerSim:
	var c := CustomerSim.new()
	c.fuel = FUELS[rng.randi_range(0, FUELS.size() - 1)]
	c.wanted_litres = float(rng.randi_range(MIN_LITRES, MAX_LITRES))
	return c

func is_full() -> bool:
	return filled_litres >= wanted_litres - 0.001

## Bir tick'te akan litre. Talebi ASLA aşmaz.
## (Web sürümünde bilinen "FULL basınca cezasız fazla dolum" exploit'i
## burada yapısal olarak imkânsız — bkz. tycoon-economy.)
func pump(delta: float, rate_l_per_s: float) -> float:
	if state != State.FUELING:
		return 0.0
	var flow := minf(delta * rate_l_per_s, wanted_litres - filled_litres)
	filled_litres += flow
	if is_full():
		state = State.PAYING
	return flow

func fill_ratio() -> float:
	return 0.0 if wanted_litres <= 0.0 else filled_litres / wanted_litres
