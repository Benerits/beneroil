extends Node3D

## Müşteri trafiği: havuzdan müşteri alır, boş pompa slotuna yollar, çıkarır.
## Ekonomi kararı YOK — satış Game.sell_fuel()'de, dolum CustomerSim'de.

signal sale(amount: float, litres: float)

const POOL_SIZE := 6
const SPAWN_MIN := 2.0
const SPAWN_MAX := 5.5
const SPAWN_X := 34.0
const EXIT_X := -34.0

## Slot sırası pompa kademesiyle aynı: 1. pompa → ilk slot.
## Konumlar pompa adalarının DIŞ kenarına hizalı (adalar z=±3).
const SLOTS := [
	Vector3(2.2, 0.2, 5.0),
	Vector3(-2.2, 0.2, 5.0),
	Vector3(2.2, 0.2, -5.0),
	Vector3(-2.2, 0.2, -5.0),
]

const MODEL_PATHS := [
	"res://assets/vehicles/sedan.glb",
	"res://assets/vehicles/suv.glb",
	"res://assets/vehicles/taxi.glb",
	"res://assets/vehicles/van.glb",
	"res://assets/vehicles/truck.glb",
]

var _models: Array[PackedScene] = []
var _pool: Array[Customer] = []
var _slot_taken := [false, false, false, false]
var _spawn_t := 1.0

func _ready() -> void:
	for path in MODEL_PATHS:
		var ps: PackedScene = load(path)
		if ps != null:
			_models.append(ps)
	if _models.is_empty():
		push_error("Araç modeli yüklenemedi — assets/vehicles import edilmiş mi?")
		return
	for i in POOL_SIZE:
		var c := Customer.new()
		c.name = "Customer%d" % i
		c.setup_visual(_models[i % _models.size()])
		c.visible = false
		c.finished.connect(_on_finished)
		c.wants_payment.connect(_on_wants_payment.bind(c))
		add_child(c)
		_pool.append(c)

func _process(delta: float) -> void:
	var rate := EconData.num("fill_rate_l_per_s")
	for c in _pool:
		c.tick(delta, rate)
	_spawn_t -= delta
	if _spawn_t <= 0.0:
		_spawn_t = Game.rng.randf_range(SPAWN_MIN, SPAWN_MAX)
		_try_spawn()

## Kaç slot açık: satın alınmış pompa sayısı (sahnedeki fiziksel slot kadar).
func active_slots() -> int:
	return mini(Game.pumps, SLOTS.size())

func _try_spawn() -> void:
	var slot := _free_slot()
	if slot < 0:
		return
	var c := _free_customer()
	if c == null:
		return
	_slot_taken[slot] = true
	c.slot_index = slot
	var target: Vector3 = SLOTS[slot]
	c.begin(
		CustomerSim.spawn(Game.rng),
		Vector3(SPAWN_X, target.y, target.z),
		target,
		Vector3(EXIT_X, target.y, target.z))

func _free_slot() -> int:
	for i in active_slots():
		if not _slot_taken[i]:
			return i
	return -1

func _free_customer() -> Customer:
	for c in _pool:
		if c.sim == null:
			return c
	return null

func _on_finished(c: Customer) -> void:
	c.sim = null

## Para akışının tek geçtiği yer: satış Game'de işlenir, sonuç yukarı yayılır.
## Slot da BURADA boşalır — araç ödeyip çekildiği an pompa serbesttir; haritadan
## çıkmasını beklemek slotu boşuna ~4 sn işgal ediyordu.
func _on_wants_payment(fuel: String, litres: float, c: Customer) -> void:
	var amount := Game.sell_fuel(fuel, litres)
	if c.slot_index >= 0:
		_slot_taken[c.slot_index] = false
		c.slot_index = -1
	sale.emit(amount, litres)
