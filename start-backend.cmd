@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Tao moi truong Python...
  py -3 -m venv .venv
  if errorlevel 1 python -m venv .venv
)
if not exist ".venv\Scripts\python.exe" (
  echo Can cai Python 3.12 va bat tuy chon Add Python to PATH.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -c "import fastapi, uvicorn, multipart, openpyxl, websockets" >nul 2>&1
if errorlevel 1 (
  echo Dang cai thu vien backend con thieu...
  ".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
  if errorlevel 1 (
    echo Khong cai duoc thu vien. Kiem tra ket noi mang va loi o tren.
    pause
    exit /b 1
  )
)
echo Backend: http://127.0.0.1:8000/docs
echo Giu cua so nay mo trong khi su dung website.
".venv\Scripts\python.exe" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
if errorlevel 1 (
  echo Backend dung do loi. Xem thong bao o tren.
  pause
)
