extends SceneTree

## Kamera PARİTE testi: Godot izometrik kamerası web sürümüyle birebir mi?
## Beklenen sabitler BİLİNÇLİ olarak elle yazılı — kaynak ../src/main.ts.

## web: CAM_ANGLES = [(1,2,1), (1.6,2,0.5), (0.5,2.2,1.6)]
## Web dünyası Z-up → ÜÇÜNCÜ bileşen yükseklik.
const WEB_ANGLES := [
	Vector3(1.0, 2.0, 1.0),
	Vector3(1.6, 2.0, 0.5),
	Vector3(0.5, 2.2, 1.6),
]
const WEB_VIEW := 26.0        # web: const VIEW = 26
const WEB_DIST := 42.0        # web: .multiplyScalar(42)
const WEB_ZOOM_MIN := 0.62
const WEB_ZOOM_MAX := 2.6
const WEB_ZOOM_RATE := 0.0012

var _fails := 0

func _init() -> void:
	print("— izometrik kamera paritesi (kaynak: web src/main.ts) —")
	var cam: Camera3D = load("res://scripts/iso_camera.gd").new()
	_check_constants(cam)
	_check_angle_mapping(cam)
	_check_elevation(cam)
	_check_zoom(cam)
	cam.free()
	print("SONUÇ: %d başarısız" % _fails)
	quit(1 if _fails > 0 else 0)

func _check_constants(cam: Camera3D) -> void:
	_eq(cam.VIEW, WEB_VIEW, "dikey görüş yüksekliği VIEW=26")
	_eq(cam.CAM_DIST, WEB_DIST, "kamera uzaklığı 42")
	_eq(cam.ZOOM_MIN, WEB_ZOOM_MIN, "zoom alt sınırı 0.62")
	_eq(cam.ZOOM_MAX, WEB_ZOOM_MAX, "zoom üst sınırı 2.6")
	_eq(cam.ZOOM_RATE, WEB_ZOOM_RATE, "zoom hızı 0.0012")
	_ok(cam.CAM_ANGLES.size() == WEB_ANGLES.size(), "3 hazır izometrik açı")

## Z-up → Y-up eşlemesi: web(x, y, z) → godot(x, z, y)
func _check_angle_mapping(cam: Camera3D) -> void:
	for i in WEB_ANGLES.size():
		var w: Vector3 = WEB_ANGLES[i]
		var expected := Vector3(w.x, w.z, w.y)
		var got: Vector3 = cam.CAM_ANGLES[i]
		_ok(got.is_equal_approx(expected),
			"açı %d eşlemesi web(%.1f,%.1f,%.1f) → godot(%.1f,%.1f,%.1f)" % [
				i, w.x, w.y, w.z, got.x, got.y, got.z])

## Yükseliş açısı = atan(yükseklik / yatay uzaklık). Web'de yükseklik z.
func _check_elevation(cam: Camera3D) -> void:
	for i in WEB_ANGLES.size():
		var w: Vector3 = WEB_ANGLES[i]
		var web_elev := rad_to_deg(atan2(w.z, Vector2(w.x, w.y).length()))
		cam.angle_index = i
		_eq2(cam.elevation_degrees(), web_elev, 0.01,
			"açı %d yükselişi %.2f°" % [i, web_elev])
	cam.angle_index = 0
	# Nominal konum web'deki 42 birim uzaklığı korumalı
	_eq2(cam.nominal_position().length(), WEB_DIST, 0.001, "nominal uzaklık 42 birim")

## web: zoom * exp(-deltaY * 0.0012), sonra 0.62..2.6 arasına kırp
func _check_zoom(cam: Camera3D) -> void:
	_eq2(cam.zoom_for_delta(1.0, -100.0), exp(0.12), 0.0001,
		"bir tekerlek çentiği içeri → ×%.5f" % exp(0.12))
	_eq2(cam.zoom_for_delta(1.0, 100.0), exp(-0.12), 0.0001,
		"bir çentik dışarı → ×%.5f" % exp(-0.12))
	_eq(cam.zoom_for_delta(WEB_ZOOM_MAX, -5000.0), WEB_ZOOM_MAX, "üst sınırda kırpılıyor")
	_eq(cam.zoom_for_delta(WEB_ZOOM_MIN, 5000.0), WEB_ZOOM_MIN, "alt sınırda kırpılıyor")

# --- yardımcılar ---

func _eq(got: float, want: float, label: String) -> void:
	_ok(is_equal_approx(got, want), "%s  (beklenen %s, gelen %s)" % [label, want, got])

func _eq2(got: float, want: float, tol: float, label: String) -> void:
	_ok(absf(got - want) <= tol, "%s  (beklenen %.4f, gelen %.4f)" % [label, want, got])

func _ok(cond: bool, label: String) -> void:
	if cond:
		print("  PASS  ", label)
	else:
		print("  FAIL  ", label)
		_fails += 1
