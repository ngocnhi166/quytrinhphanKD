import os
import subprocess
import tempfile
from pathlib import Path

from fastapi import HTTPException

# Printing uses the Edge (always present on Windows) or Chrome that is already installed, so the PDF looks
# exactly like the report on screen. T12_PDF_BROWSER may point at another Chromium-based browser.
BROWSERS = [
    os.environ.get("T12_PDF_BROWSER"),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]
STYLE = ("@page{size:A4;margin:12mm}html{overflow:auto}"
         "body{margin:0;padding:0 8px;min-width:max-content;overflow-x:clip;font:15px/1.7 Arial,sans-serif;background:white;color:#203b34}"
         "*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}"
         "table{border-collapse:collapse;max-width:100%}img,svg{max-width:100%}pre{white-space:pre-wrap;font:inherit}"
         ".t12-meta{max-width:808px;margin:0 auto 18px;padding:0 20px 14px;border-bottom:1px solid #dfe6d8;font-size:12px;color:#5f6f63}"
         ".t12-meta h1{font-size:20px;margin:0 0 6px;color:#203b34}.t12-meta p{margin:2px 0}")


def browser():
    return next((path for path in BROWSERS if path and Path(path).is_file()), None)


def render_pdf(body_html):
    exe = browser()
    if not exe:
        raise HTTPException(501, "Không tìm thấy Microsoft Edge hoặc Google Chrome để tạo PDF.")
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        folder = Path(tmp)
        source, out = folder / "report.html", folder / "report.pdf"
        # The report is untrusted page content: the CSP blocks scripts and every network request while printing.
        source.write_text("<!doctype html><html lang=\"vi\"><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" "
                          "content=\"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:\">"
                          f"<style>{STYLE}</style></head><body>{body_html}</body></html>", encoding="utf-8")
        try:
            container_flags = ["--no-sandbox", "--disable-dev-shm-usage"] if os.name != "nt" else []
            subprocess.run([exe, *container_flags, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--user-data-dir={folder / 'profile'}",
                            f"--print-to-pdf={out}", source.as_uri()], capture_output=True, timeout=60)
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "Tạo PDF quá thời gian, hãy thử lại.")
        if not out.is_file():
            raise HTTPException(500, "Không tạo được PDF.")
        return out.read_bytes()
