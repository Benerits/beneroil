extends Camera3D

## Web sürümünün kamerasının BİREBİR portu.
## Kaynak: ../src/main.ts (VIEW, CAM_ANGLES, updateCamera, resize, wheel zoom).
##
## ⚠️ Eksen düzeni: web dünyası Z-up (modeller rotation.x=PI/2 ile dikiliyor,
## yükseklik position.z). Godot Y-up. Motorla kavga etmemek için Godot'ta Y-up
## KALIYORUZ; eşleme web(x, y, z_yukarı) → godot(x, z, y_yukarı).
## Böylece web'in camDir=(1,2,1) yönü Godot'ta (1,1,2) olur — yükseklik/yatay
## oranı, dolayısıyla izometrik açı birebir aynı kalır (yatay düzlemden 24,1°).
##
## ⚠️ Web ortografikte near=-200 kullanıyor (kamera düzleminin arkasındaki
## zemin kırpılmasın diye). Godot'ta near>0 olmak zorunda; ortografik
## projeksiyonda görüntü mesafeden BAĞIMSIZ olduğu için aynı yön üzerinde
## kamerayı geriye çekmek matematiksel olarak aynı sonucu verir.

const VIEW := 26.0             # web: const VIEW = 26 — dikey görüş yüksekliği
const CAM_DIST := 42.0         # web: .multiplyScalar(42)
const ZOOM_MIN := 0.62         # web: Math.max(0.62, …)
const ZOOM_MAX := 2.6          # web: Math.min(2.6, …)
const ZOOM_RATE := 0.0012      # web: Math.exp(-e.deltaY * 0.0012)
const WHEEL_DELTA := 100.0     # tarayıcıda bir tekerlek çentiği ≈ 100 deltaY
const PULL_BACK := 220.0       # near=-200'ün Godot karşılığı
const NEAR := 0.1
const FAR := 520.0

## web: CAM_ANGLES = [(1,2,1), (1.6,2,0.5), (0.5,2.2,1.6)] — üçüncü bileşen
## yükseklik. Aşağısı Godot eşlemesi (x, yükseklik, z).
const CAM_ANGLES := [
	Vector3(1.0, 1.0, 2.0),
	Vector3(1.6, 0.5, 2.0),
	Vector3(0.5, 1.6, 2.2),
]

signal angle_changed(index: int)

var zoom := 1.0
var angle_index := 0
var target := Vector3.ZERO     # web: camX / camY — zemin üzerinde kaydırma

var _dragging := false

func _ready() -> void:
	projection = PROJECTION_ORTHOGONAL
	keep_aspect = KEEP_HEIGHT    # web: top/bottom sabit, left/right aspect'ten
	near = NEAR
	far = FAR
	_apply()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP and mb.pressed:
			_zoom_by(-WHEEL_DELTA)
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and mb.pressed:
			_zoom_by(WHEEL_DELTA)
		elif mb.button_index == MOUSE_BUTTON_LEFT:
			_dragging = mb.pressed
	elif event is InputEventMouseMotion and _dragging:
		_pan_by_pixels((event as InputEventMouseMotion).relative)
	elif event is InputEventKey:
		var k := event as InputEventKey
		if k.pressed and not k.echo and k.keycode == KEY_R:
			cycle_angle()

## web: camera.zoom = clamp(zoom * exp(-deltaY * 0.0012))
## Saf fonksiyon — parite testi sahne/ağaç kurmadan doğrulayabilsin.
func zoom_for_delta(current: float, delta_y: float) -> float:
	return clampf(current * exp(-delta_y * ZOOM_RATE), ZOOM_MIN, ZOOM_MAX)

func _zoom_by(delta_y: float) -> void:
	zoom = zoom_for_delta(zoom, delta_y)
	_apply()

## web: cycleCameraAngle() — oyuncunun "açı" butonu
func cycle_angle() -> void:
	angle_index = (angle_index + 1) % CAM_ANGLES.size()
	_apply()
	angle_changed.emit(angle_index)

## Ekranda sürüklenen piksel → zemin üzerinde kaydırma.
## Ortografikte 1 piksel = (VIEW/zoom)/viewport_yüksekliği dünya birimi.
func _pan_by_pixels(pixels: Vector2) -> void:
	var vh := float(get_viewport().get_visible_rect().size.y)
	if vh <= 0.0:
		return
	var units_per_px := (VIEW / zoom) / vh
	var right := global_basis.x
	right.y = 0.0
	# Ekranda "yukarı", zeminde kameradan uzağa doğru olan yön
	var up_on_ground := -global_basis.z
	up_on_ground.y = 0.0
	if right.length_squared() < 0.0001 or up_on_ground.length_squared() < 0.0001:
		return
	target -= right.normalized() * pixels.x * units_per_px
	target += up_on_ground.normalized() * pixels.y * units_per_px
	_apply()

func _apply() -> void:
	# web: camera.top/bottom = ±VIEW/2, zoom projeksiyonu böler
	size = VIEW / zoom
	var dir: Vector3 = CAM_ANGLES[angle_index].normalized()
	# CAM_DIST web'deki nominal uzaklık; ortografikte görüntüyü etkilemez,
	# PULL_BACK yalnız kırpma payı için (near<0 yerine).
	var pos := target + dir * PULL_BACK
	# Matrisi motora hesaplat — .tscn/elle matris transpoze tuzağı (godot-gdscript)
	global_transform = Transform3D(Basis(), pos).looking_at(target, Vector3.UP)

## Web'deki nominal kamera konumu (ortografik olduğu için görüntü aynı) —
## parite testinde açının birebirliğini doğrulamak için.
func nominal_position() -> Vector3:
	return target + CAM_ANGLES[angle_index].normalized() * CAM_DIST

## Yatay düzlemden yükseliş açısı (derece). Web (1,2,1) için 24,1°.
func elevation_degrees() -> float:
	var d: Vector3 = CAM_ANGLES[angle_index].normalized()
	return rad_to_deg(atan2(d.y, Vector2(d.x, d.z).length()))
