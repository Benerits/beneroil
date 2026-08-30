class_name Customer
extends Node3D

## Bir müşteri örneği: görseli taşır ve hareket ettirir, karar mantığını
## CustomerSim'e, para akışını Game'e delege eder.
##
## HAVUZLANIR: her müşteride instantiate()/queue_free() döngüsü GC
## tırtıklaması yapar (bkz. godot-gdscript skill'i).

signal finished(customer: Customer)

## Müşteri ekonomiyi TANIMAZ: ödeme isteğini yayınlar, parayı traffic.gd
## Game üzerinden işler. Böylece bu sınıf autoload'suz da yüklenebilir.
signal wants_payment(fuel: String, litres: float)

const SPEED := 9.0
const ARRIVE_EPS := 0.2

var sim: CustomerSim = null
var slot_index: int = -1

var _visual: Node3D = null
var _target := Vector3.ZERO
var _exit := Vector3.ZERO

## Havuz kurulurken bir kez çağrılır.
func setup_visual(scene: PackedScene) -> void:
	_visual = scene.instantiate()
	_visual.scale = Vector3(1.7, 1.7, 1.7)
	add_child(_visual)

func begin(new_sim: CustomerSim, spawn_pos: Vector3, slot: Vector3, exit_pos: Vector3) -> void:
	sim = new_sim
	position = spawn_pos
	_target = slot
	_exit = exit_pos
	visible = true
	_face_towards(_target)

func tick(delta: float, fill_rate: float) -> void:
	if sim == null:
		return
	match sim.state:
		CustomerSim.State.ARRIVING:
			if _move_towards(_target, delta):
				sim.state = CustomerSim.State.FUELING
		CustomerSim.State.FUELING:
			sim.pump(delta, fill_rate)
		CustomerSim.State.PAYING:
			wants_payment.emit(sim.fuel, sim.filled_litres)
			sim.state = CustomerSim.State.LEAVING
			_face_towards(_exit)
		CustomerSim.State.LEAVING:
			if _move_towards(_exit, delta):
				sim.state = CustomerSim.State.DONE
				visible = false
				finished.emit(self)
		CustomerSim.State.DONE:
			pass

func _move_towards(dest: Vector3, delta: float) -> bool:
	var to := dest - position
	var dist := to.length()
	if dist <= ARRIVE_EPS:
		position = dest
		return true
	position += to / dist * minf(SPEED * delta, dist)
	return false

## Kenney araç kiti +Z yönüne bakıyor (ön tekerler z=+0.66), Godot'un look_at'i
## ise -Z'yi hedefe çevirir — bu yüzden hedefin AKSİ yönüne bakıyoruz.
## Matrisi elle yazmak yerine motora hesaplatmak kuraldır (.tscn transpoze tuzağı).
func _face_towards(dest: Vector3) -> void:
	var dir := dest - position
	dir.y = 0.0
	if dir.length_squared() < 0.001:
		return
	look_at(position - dir, Vector3.UP)
