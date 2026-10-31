import csv
import io
import zipfile
from collections import Counter
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from fastapi import HTTPException
from openpyxl import load_workbook

MAX_BYTES = 4 * 1024 * 1024


def parse_file(name: str, raw: bytes) -> dict:
    if not raw:
        raise HTTPException(422, "Tệp rỗng, vui lòng chọn tệp có dữ liệu.")
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "Tệp vượt quá giới hạn 4 MB.")
    suffix = Path(name).suffix.lower()
    try:
        if suffix == ".csv":
            text = raw.decode("utf-8-sig")
            try:
                dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t")
            except csv.Error:
                dialect = csv.excel
            rows = list(csv.reader(io.StringIO(text), dialect))
        elif suffix == ".xlsx":
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                if sum(i.file_size for i in archive.infolist()) > 40 * 1024 * 1024:
                    raise ValueError("XLSX giải nén quá lớn.")
            book = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
            try:
                rows = []
                for row in book.worksheets[0].iter_rows(values_only=True):
                    if len(rows) > 10000 or len(row) > 50:
                        raise ValueError("Tối đa 10.000 dòng và 50 cột.")
                    rows.append(list(row))
            finally:
                book.close()
        else:
            raise ValueError("Chỉ hỗ trợ .csv và .xlsx; hãy lưu tệp .xls thành .xlsx.")
        rows = [r for r in rows if any(v is not None and str(v).strip() for v in r)]
        if len(rows) < 2:
            raise ValueError("Tệp phải có tiêu đề và ít nhất một dòng dữ liệu.")
        headers = [str(v or "").strip() for v in rows[0]]
        if not all(headers) or len(set(headers)) != len(headers):
            raise ValueError("Tên cột không được trống hoặc trùng nhau.")
        if len(headers) > 50 or len(rows) - 1 > 10000:
            raise ValueError("Tối đa 10.000 dòng và 50 cột.")
        data = []
        for number, row in enumerate(rows[1:], 2):
            if len(row) != len(headers):
                raise ValueError(f"Dòng {number} có số ô không khớp tiêu đề.")
            values = [v.isoformat() if isinstance(v, (date, datetime)) else str(v) if v is not None else "" for v in row]
            if any(len(v) > 1000 for v in values):
                raise ValueError(f"Dòng {number} có ô dài hơn 1.000 ký tự.")
            data.append(dict(zip(headers, values)))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, f"Không đọc được dữ liệu: {exc}") from exc
    numeric, missing = {}, {}
    for col in headers:
        values = [r[col].strip() for r in data]
        missing[col] = sum(not v for v in values)
        numbers = []
        for value in filter(None, values):
            try:
                number = Decimal(value)
                if not number.is_finite() or abs(number) > Decimal('1e100'):
                    break
                numbers.append(number)
            except InvalidOperation:
                break
        else:
            if numbers:
                numeric[col] = {"count": len(numbers), "sum": str(sum(numbers)), "mean": str(sum(numbers) / len(numbers)), "min": str(min(numbers)), "max": str(max(numbers))}
    groups = {}
    for col in headers:
        if col not in numeric and len(set(r[col] for r in data)) <= 30:
            groups[col] = dict(Counter(r[col] for r in data))
    return {"columns": headers, "row_count": len(data), "preview": data[:8], "metrics": {"row_count": len(data), "missing_values": missing, "duplicate_rows": len(data) - len(set(tuple(r.values()) for r in data)), "numeric": numeric, "category_counts": groups}}
