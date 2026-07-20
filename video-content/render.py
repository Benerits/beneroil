#!/usr/bin/env python3
# BenelOil rafineri sahnesini kare kare render eder → PNG dizisi. ffmpeg ile MP4'e çevrilir.
import sys, subprocess, time, socket, os, signal
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SCENE = os.path.join(HERE, "scene")
OUT = os.path.join(HERE, "frames")
FPS = 30
DUR = 21.0                     # saniye (CYCLE=10.5s -> tam 2 dongu)
N = int(FPS * DUR)
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith(".png"): os.remove(os.path.join(OUT, f))

# statik server
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8099"], cwd=SCENE,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True,
            args=["--use-angle=swiftshader","--use-gl=angle","--ignore-gpu-blocklist","--force-color-profile=srgb"])
        pg = b.new_page(viewport={"width":1080,"height":1080}, device_scale_factor=1)
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://localhost:8099/index.html")
        pg.wait_for_function("window.__ready === true", timeout=20000)
        t0 = time.time()
        for i in range(N):
            t = i / FPS
            pg.evaluate(f"window.renderAt({t})")
            pg.screenshot(path=os.path.join(OUT, f"f{i:04d}.png"))
            if i % 30 == 0: print(f"  kare {i}/{N}  ({time.time()-t0:.0f}s)", flush=True)
        b.close()
        if errs: print("PAGEERRORS:", errs[:3])
    print(f"bitti: {N} kare → {OUT}")
finally:
    srv.terminate()
