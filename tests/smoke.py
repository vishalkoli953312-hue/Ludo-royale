"""Headless-Chromium smoke test (mock renderer). Run:  python3 tests/smoke.py"""
import json, sys, threading, http.server, socketserver, functools, os, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = "/tmp/ludo-shots"; os.makedirs(OUT, exist_ok=True)
PORT = 8765

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Quiet, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

errors, checks = [], []
def check(name, cond, extra=""):
    checks.append((name, bool(cond)))
    print(("  ok   " if cond else "  FAIL ") + name + (f"  {extra}" if extra and not cond else ""))

def wallet(page):
    return page.evaluate("JSON.parse(localStorage.getItem('ludo-royale:wallet:v1'))")

def play_to_end(page, limit_s=170):
    # Auto-player runs inside the page (no per-tap round-trips): taps Roll and picks the first legal pawn.
    page.evaluate("""() => { window.__auto = setInterval(() => {
        const b = document.querySelector('#btn-roll'); if (b && !b.disabled) b.click();
        const c = window.__ludo.controller, w = c.tokenWaiter;
        if (w) c.requestToken({ seat: c.state.turn, token: w.moves[0].token });
      }, 5); }""")
    try:
        page.wait_for_selector(".result-title", timeout=limit_s * 1000)
        ok = True
    except Exception:
        ok = False
    page.evaluate("clearInterval(window.__auto)")
    return ok

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.add_init_script("window.__LUDO_TEST__ = true; window.__LUDO_SPEED__ = 60;")
    ctx.add_init_script(path=os.path.join(ROOT, "tests", "mock-renderer.js"))
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)

    print("Lobby")
    page.goto(f"http://127.0.0.1:{PORT}/index.html")
    page.wait_for_selector("#lobby:not([hidden])", timeout=8000)
    page.wait_for_timeout(700)
    check("lobby visible, loading overlay hidden", page.locator("#loading").is_hidden())
    check("4 tables rendered", page.locator(".table-row").count() == 4)
    check("starting balance 1,000", page.inner_text("#coins-lobby") == "1,000")
    check("daily gift offered", page.locator("#btn-daily").is_visible())
    page.screenshot(path=f"{OUT}/1-lobby-portrait.png")
    page.click("#btn-daily"); page.wait_for_timeout(900)
    check("daily gift credited (+250)", wallet(page)["balance"] == 1250)
    check("daily gift button disappears", page.locator("#btn-daily").is_hidden())
    page.click(".table-row[data-id=silver]")
    check("silver selected", page.get_attribute(".table-row[data-id=silver]", "aria-checked") == "true")
    page.click(".table-row[data-id=bronze]")

    print("Match flow and earnings")
    page.click("#btn-play")
    page.wait_for_selector("#hud:not([hidden])")
    w = wallet(page)
    check("entry fee deducted up-front (1250 -> 1150)", w["balance"] == 1150 and w["match"] and w["match"]["entry"] == 100)
    check("4 seat chips? (1 opponent = 2)", page.locator(".seat").count() == 2)
    check("prize shows pot 200", page.inner_text("#prize") == "200")
    page.wait_for_function("!document.querySelector('#btn-roll').disabled", timeout=5000)
    page.screenshot(path=f"{OUT}/2-hud-portrait.png")
    ins = page.evaluate("window.__ludo.renderer.insets")
    check("camera insets reserve HUD space", ins["top"] > 60 and ins["bottom"] > 60, str(ins))

    # menu + pause
    page.click("#btn-menu"); page.wait_for_selector(".sheet")
    page.screenshot(path=f"{OUT}/3-menu.png")
    check("game paused while menu open", page.evaluate("window.__ludo.controller.paused") is True)
    page.click("[data-a=resume]"); page.wait_for_timeout(100)
    check("game resumes", page.evaluate("window.__ludo.controller.paused") is False)

    # reload mid-game -> resume
    page.wait_for_timeout(300)
    page.reload(); page.wait_for_selector("#lobby:not([hidden])", timeout=8000); page.wait_for_timeout(500)
    check("resume offered after reload", page.locator("#btn-resume").is_visible())
    page.click("#btn-resume"); page.wait_for_selector("#hud:not([hidden])")
    check("resumed without charging again", wallet(page)["balance"] == 1150)

    # fx screenshot while playing
    page.evaluate("""() => { const f = window.__ludo.fx; f.capture(120, 420, [255,110,130], [110,170,255]);
        f.ripple(230, 470, {color:[90,240,160], amp:1.2, life:2.2, speed:240});
        f.homeArrive(200, 330); f.text(200, 300, '+10'); }""")
    page.wait_for_timeout(450)
    page.screenshot(path=f"{OUT}/4-fx-interference.png")
    page.evaluate("window.__ludo.fx.celebrate()"); page.wait_for_timeout(700)
    page.screenshot(path=f"{OUT}/5-fx-celebrate.png")

    done = play_to_end(page)
    check("match finished with a result sheet", done)
    page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/6-result.png")
    w = wallet(page)
    check("one game recorded", w["games"] == 1)
    check("books balance: balance == 1000 + earned - spent", w["balance"] == 1000 + w["earned"] - w["spent"], json.dumps({k: w[k] for k in ('balance','earned','spent')}))
    check("no active match after settle", w["match"] is None)
    check("session cleared", page.evaluate("localStorage.getItem('ludo-royale:session:v1')") is None)
    won = w["wins"] == 1
    print("   result:", "human won" if won else "CPU won", "| balance", w["balance"])

    page.click("[data-a=lobby]"); page.wait_for_selector("#lobby:not([hidden])")
    page.click("#btn-stats"); page.wait_for_selector(".stats"); page.wait_for_timeout(200)
    page.screenshot(path=f"{OUT}/7-stats.png")
    check("stats show ledger rows", page.locator(".ledger li").count() >= 2)
    page.click("[data-a=close]")

    print("Quit forfeits entry")
    bal = wallet(page)["balance"]
    page.click("#btn-play"); page.wait_for_selector("#hud:not([hidden])")
    check("entry charged", wallet(page)["balance"] == bal - 100)
    page.click("#btn-menu"); page.click("[data-a=quit]"); page.wait_for_selector("[data-a=yes]"); page.click("[data-a=yes]")
    page.wait_for_selector("#lobby:not([hidden])")
    w = wallet(page)
    check("forfeit settled, no match left", w["match"] is None and w["balance"] == bal - 100)

    print("Landscape")
    page.set_viewport_size({"width": 844, "height": 390}); page.wait_for_timeout(400)
    page.screenshot(path=f"{OUT}/8-lobby-landscape.png")
    page.select_option if False else None
    page.click(".table-row[data-id=practice]"); page.click("#btn-play"); page.wait_for_selector("#hud:not([hidden])")
    page.wait_for_function("!document.querySelector('#btn-roll').disabled", timeout=5000)
    page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/9-hud-landscape.png")
    ins = page.evaluate("window.__ludo.renderer.insets")
    check("landscape: HUD reserves right side", ins["right"] > 100, str(ins))
    b.close()

httpd.shutdown()
bad = [e for e in errors if "favicon" not in e and "serviceWorker" not in e]
check("no console/page errors", not bad, "\n   " + "\n   ".join(bad[:8]))
failed = [n for n, ok in checks if not ok]
print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed. Screenshots in {OUT}")
sys.exit(1 if failed else 0)
