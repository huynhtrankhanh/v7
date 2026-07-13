#!/usr/bin/env python3
import argparse
import subprocess
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread

from PIL import Image, ImageDraw, ImageFont

SCRIPT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ARTIFACTS_DIR = SCRIPT_ROOT / "android-artifacts"

BG = "#111827"
ACCENT = "#e2b714"
FG = "#f8fafc"

SCREENSHOTS = [
    ("phone-portrait-1080x1920", 1080, 1920),
    ("phone-landscape-1920x1080", 1920, 1080),
    ("tablet-portrait-1440x2560", 1440, 2560),
    ("tablet-landscape-2560x1440", 2560, 1440),
]


def font_path() -> Path | None:
    candidates = [
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = font_path()
    if path:
        return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def text_size(draw: ImageDraw.ImageDraw, text: str, font) -> tuple[int, int]:
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    return right - left, bottom - top


def fit_font(draw: ImageDraw.ImageDraw, text: str, max_width: int, start_size: int) -> ImageFont.FreeTypeFont:
    size = start_size
    while size > 12:
        font = load_font(size)
        width, _ = text_size(draw, text, font)
        if width <= max_width:
            return font
        size -= 2
    return load_font(12)


def draw_app_mark(size: int, *, round_icon: bool, transparent: bool = False) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0) if transparent else tuple(int(BG[i : i + 2], 16) for i in (1, 3, 5)) + (255,))
    draw = ImageDraw.Draw(image)

    if not transparent:
        if round_icon:
            draw.ellipse((0, 0, size - 1, size - 1), fill=BG)
        else:
            radius = int(size * 0.22)
            draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=BG)

        halo = int(size * 0.02)
        draw.ellipse(
            (int(size * 0.14) - halo, int(size * 0.14) - halo, int(size * 0.86) + halo, int(size * 0.86) + halo),
            outline=(226, 183, 20, 48),
            width=max(2, int(size * 0.012)),
        )

    mark_font = fit_font(draw, "V7", int(size * 0.72), int(size * 0.58))
    mark_w, mark_h = text_size(draw, "V7", mark_font)
    mark_x = (size - mark_w) // 2
    mark_y = int(size * 0.29) - mark_h // 2

    draw.text((mark_x, mark_y), "V7", font=mark_font, fill=FG)
    underline_y = mark_y + mark_h + int(size * 0.025)
    draw.rounded_rectangle(
        (
            int(size * 0.30),
            underline_y,
            int(size * 0.70),
            underline_y + max(3, int(size * 0.018)),
        ),
        radius=max(2, int(size * 0.01)),
        fill=ACCENT,
    )

    return image


def write_png(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def generate_icon_resources(root_dir: Path, artifacts_dir: Path) -> None:
    res_dir = root_dir / "practice-android" / "app" / "src" / "main" / "res"
    write_text(
        res_dir / "drawable" / "ic_launcher_background.xml",
        """<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#111827" />
</shape>
""",
    )
    write_text(
        res_dir / "mipmap-anydpi-v26" / "ic_launcher.xml",
        """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
""",
    )
    write_text(
        res_dir / "mipmap-anydpi-v26" / "ic_launcher_round.xml",
        """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
""",
    )

    write_png(res_dir / "drawable" / "ic_launcher_foreground.png", draw_app_mark(432, round_icon=False, transparent=True))
    write_png(artifacts_dir / "play-store" / "app-icon-512.png", draw_app_mark(512, round_icon=False, transparent=False))

    density_sizes = {
        "mdpi": 48,
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192,
    }
    for density, px in density_sizes.items():
        write_png(res_dir / f"mipmap-{density}" / "ic_launcher.png", draw_app_mark(px, round_icon=False))
        write_png(res_dir / f"mipmap-{density}" / "ic_launcher_round.png", draw_app_mark(px, round_icon=True))


def start_static_server(static_dir: Path) -> tuple[ThreadingHTTPServer, str]:
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(static_dir), **kwargs)

        def log_message(self, format, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_port}"


def chromium_path() -> str | None:
    env = subprocess.run(
        ["bash", "-lc", "command -v chromium || command -v chromium-browser || command -v google-chrome"],
        check=False,
        capture_output=True,
        text=True,
    )
    if env.returncode != 0 or not env.stdout.strip():
        return None
    return env.stdout.strip()


def generate_screenshots(root_dir: Path, artifacts_dir: Path) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("playwright is required for screenshot generation") from exc

    server, base_url = start_static_server(root_dir / "static")
    output_dir = artifacts_dir / "play-store"
    output_dir.mkdir(parents=True, exist_ok=True)

    exec_path = chromium_path()
    try:
        with sync_playwright() as playwright:
            launch_options = {"headless": True, "args": ["--no-sandbox"]}
            if exec_path:
                launch_options["executable_path"] = exec_path
            browser = playwright.chromium.launch(**launch_options)
            page = browser.new_page()
            for name, width, height in SCREENSHOTS:
                page.set_viewport_size({"width": width, "height": height})
                page.goto(f"{base_url}/practice.html", wait_until="domcontentloaded")
                page.click("#start-btn")
                page.wait_for_function(
                    """() => {
                        const target = document.querySelector('#target');
                        return target && target.textContent && target.textContent.trim() !== '-' && target.textContent.trim() !== 'press start';
                    }""",
                    timeout=10000,
                )
                page.screenshot(path=str(output_dir / f"{name}.png"))
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Google Play assets for V7 Practice.")
    parser.add_argument("--root-dir", default=str(SCRIPT_ROOT))
    parser.add_argument("--artifacts-dir", default=str(DEFAULT_ARTIFACTS_DIR))
    parser.add_argument("--icons-only", action="store_true")
    parser.add_argument("--screenshots-only", action="store_true")
    args = parser.parse_args()

    root_dir = Path(args.root_dir)
    artifacts_dir = Path(args.artifacts_dir)
    if not args.screenshots_only:
        generate_icon_resources(root_dir, artifacts_dir)
    if not args.icons_only:
        generate_screenshots(root_dir, artifacts_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
