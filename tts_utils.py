# tts_utils.py
# Engine preprocessing teks untuk edge-tts (Bahasa Indonesia)
# Rules disimpan di SQLite, bisa dikelola via UI /tts-settings
#
# Usage di app.py / modul lain:
#   from tts_utils import preprocess_tts, speak
#
#   teks_bersih = preprocess_tts("Suhu 27,8°C")
#   await speak("Suhu 27,8°C", voice="id-ID-TutiNeural", output="out.mp3")

import re
import sqlite3
import asyncio
from pathlib import Path
from typing import Optional

# ── Config ────────────────────────────────────────────────────────────────────

DB_PATH = Path(__file__).parent / "tts_rules.db"

# ── Database init ─────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Buat tabel + seed default rules jika belum ada."""
    with _get_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS tts_rules (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            label       TEXT    NOT NULL,
            category    TEXT    NOT NULL DEFAULT 'custom',
            pattern     TEXT    NOT NULL,
            replacement TEXT    NOT NULL,
            rule_type   TEXT    NOT NULL DEFAULT 'regex',
            sort_order  INTEGER NOT NULL DEFAULT 0,
            active      INTEGER NOT NULL DEFAULT 1,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tts_kamus (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            kata_asal   TEXT    NOT NULL UNIQUE,
            kata_ganti  TEXT    NOT NULL,
            bahasa      TEXT    NOT NULL DEFAULT 'id',
            active      INTEGER NOT NULL DEFAULT 1,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tts_ssml (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            nama        TEXT    NOT NULL,
            trigger     TEXT    NOT NULL,
            ssml_wrap   TEXT    NOT NULL,
            active      INTEGER NOT NULL DEFAULT 1,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # Seed default rules hanya jika tabel kosong
        count = conn.execute("SELECT COUNT(*) FROM tts_rules").fetchone()[0]
        if count == 0:
            _seed_default_rules(conn)

        count_kamus = conn.execute("SELECT COUNT(*) FROM tts_kamus").fetchone()[0]
        if count_kamus == 0:
            _seed_default_kamus(conn)


def _seed_default_rules(conn: sqlite3.Connection):
    rules = [
        # (label, category, pattern, replacement, rule_type, sort_order)
        # --- Markup cleanup ---
        ("Bold markdown",       "markup",   r"\*\*(.*?)\*\*",           r"\1",  "regex", 10),
        ("Italic markdown",     "markup",   r"\*(.*?)\*",               r"\1",  "regex", 11),
        ("Underline markdown",  "markup",   r"__(.*?)__",               r"\1",  "regex", 12),
        ("Link markdown",       "markup",   r"\[([^\]]+)\]\([^\)]+\)",  r"\1",  "regex", 13),
        ("Bracket label",       "markup",   r"\[([^\]]+)\]",            r"\1",  "regex", 14),
        ("Inline code",         "markup",   r"`([^`]+)`",               r"\1",  "regex", 15),

        # --- Suhu ---
        ("Derajat Celsius",     "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*°C",    "__SUHU_C__",   "regex_fn", 20),
        ("Derajat Fahrenheit",  "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*°F",    "__SUHU_F__",   "regex_fn", 21),
        ("Derajat Kelvin",      "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*°K",    "__SUHU_K__",   "regex_fn", 22),

        # --- Persentase & tekanan ---
        ("Persen",              "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*%",     "__PCT__",      "regex_fn", 30),
        ("Milibar",             "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*mbar",  "__MBAR__",     "regex_fn", 31),
        ("Kilopaskal",          "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*kPa",   "__KPA__",      "regex_fn", 32),
        ("Bar",                 "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*bar\b", "__BAR__",      "regex_fn", 33),

        # --- Kecepatan & jarak (multi-char dulu) ---
        ("Km per jam",          "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*km/h",  "__KMH__",      "regex_fn", 40),
        ("Meter per detik",     "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*m/s",   "__MS__",       "regex_fn", 41),
        ("Kilometer",           "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*km\b",  "__KM__",       "regex_fn", 42),
        ("Sentimeter",          "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*cm\b",  "__CM__",       "regex_fn", 43),
        ("Milimeter",           "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*mm\b",  "__MM__",       "regex_fn", 44),
        ("Meter",               "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*m\b",   "__M__",        "regex_fn", 45),

        # --- Massa ---
        ("Kilogram",            "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*kg\b",  "__KG__",       "regex_fn", 50),
        ("Gram",                "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*gr?\b", "__GR__",       "regex_fn", 51),
        ("Miligram",            "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*mg\b",  "__MG__",       "regex_fn", 52),

        # --- Listrik (multi-char dulu) ---
        ("Milivolt",            "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*mV\b",  "__MV__",       "regex_fn", 60),
        ("Kilovolt",            "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*kV\b",  "__KV__",       "regex_fn", 61),
        ("Volt",                "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*V\b",   "__V__",        "regex_fn", 62),
        ("Miliampere",          "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*mA\b",  "__MA__",       "regex_fn", 63),
        ("Ampere",              "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*A\b",   "__A__",        "regex_fn", 64),
        ("Kilowatt",            "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*kW\b",  "__KW__",       "regex_fn", 65),
        ("Watt",                "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*W\b",   "__W__",        "regex_fn", 66),
        ("Ohm",                 "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*Ω\b",   "__OHM__",      "regex_fn", 67),

        # --- Frekuensi & waktu (multi-char dulu) ---
        ("Gigahertz",           "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*GHz\b", "__GHZ__",      "regex_fn", 70),
        ("Megahertz",           "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*MHz\b", "__MHZ__",      "regex_fn", 71),
        ("Kilohertz",           "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*kHz\b", "__KHZ__",      "regex_fn", 72),
        ("Hertz",               "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*Hz\b",  "__HZ__",       "regex_fn", 73),
        ("Milidetik",           "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*ms\b",  "__MSEC__",     "regex_fn", 74),
        ("Detik",               "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*s\b",   "__SEC__",      "regex_fn", 75),

        # --- Storage ---
        ("Gigabyte",            "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*[Gg][Bb]\b", "__GB__",  "regex_fn", 80),
        ("Megabyte",            "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*[Mm][Bb]\b", "__MB__",  "regex_fn", 81),
        ("Kilobyte",            "satuan",   r"(-?\d+(?:[.,]\d+)?)\s*[Kk][Bb]\b", "__KB__",  "regex_fn", 82),

        # --- Separator ---
        ("Em-dash ke koma",     "separator", r"\s*[—–]\s*",              ", ",   "regex", 90),
        ("Elipsis ke koma",     "separator", r"(?<!\d)\.{3}(?!\d)",      ", ",   "regex", 91),

        # --- Angka desimal sisa ---
        ("Desimal koma",        "angka",    r"(-?\d+),(\d+)",            r"\1 koma \2",  "regex", 99),
    ]
    conn.executemany(
        "INSERT INTO tts_rules (label, category, pattern, replacement, rule_type, sort_order) VALUES (?,?,?,?,?,?)",
        rules
    )


def _seed_default_kamus(conn: sqlite3.Connection):
    kamus = [
        # (kata_asal, kata_ganti, bahasa)
        ("dengan",   "déngan",   "id"),
        ("mereka",   "méréka",   "id"),
        ("tempat",   "témpat",   "id"),
        ("perlu",    "pérlu",    "id"),
        ("kerja",    "kérja",    "id"),
    ]
    conn.executemany(
        "INSERT INTO tts_kamus (kata_asal, kata_ganti, bahasa) VALUES (?,?,?)",
        kamus
    )


# ── Konversi angka ke kata Bahasa Indonesia ───────────────────────────────────

_ONES = [
    "", "satu", "dua", "tiga", "empat", "lima",
    "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"
]


def _angka_ke_kata(n: int) -> str:
    if n < 0:        return "minus " + _angka_ke_kata(-n)
    if n < 12:       return _ONES[n]
    if n < 20:       return _ONES[n - 10] + " belas"
    if n < 100:      return _ONES[n // 10] + " puluh" + (f" {_ONES[n % 10]}" if n % 10 else "")
    if n < 200:      return "seratus" + (f" {_angka_ke_kata(n % 100)}" if n % 100 else "")
    if n < 1000:     return _ONES[n // 100] + " ratus" + (f" {_angka_ke_kata(n % 100)}" if n % 100 else "")
    if n < 2000:     return "seribu" + (f" {_angka_ke_kata(n % 1000)}" if n % 1000 else "")
    if n < 1_000_000:
        return _angka_ke_kata(n // 1000) + " ribu" + (f" {_angka_ke_kata(n % 1000)}" if n % 1000 else "")
    if n < 1_000_000_000:
        return _angka_ke_kata(n // 1_000_000) + " juta" + (f" {_angka_ke_kata(n % 1_000_000)}" if n % 1_000_000 else "")
    return str(n)


def _bilangan_ke_kata(s: str) -> str:
    s = str(s).replace(",", ".")
    negatif = s.startswith("-")
    s = s.lstrip("-")
    if "." in s:
        bulat, desimal = s.split(".", 1)
        kata_des = " ".join(_ONES[int(d)] for d in desimal if d.isdigit())
        hasil = f"{_angka_ke_kata(int(bulat or 0))} koma {kata_des}"
    else:
        hasil = _angka_ke_kata(int(s))
    return ("minus " + hasil) if negatif else hasil


# ── Mapping token satuan → teks ───────────────────────────────────────────────

_SATUAN_MAP = {
    "__SUHU_C__":   "derajat selsius",
    "__SUHU_F__":   "derajat fahrenheit",
    "__SUHU_K__":   "kelvin",
    "__PCT__":      "persen",
    "__MBAR__":     "milibar",
    "__KPA__":      "kilopaskal",
    "__BAR__":      "bar",
    "__KMH__":      "kilometer per jam",
    "__MS__":       "meter per detik",
    "__KM__":       "kilometer",
    "__CM__":       "sentimeter",
    "__MM__":       "milimeter",
    "__M__":        "meter",
    "__KG__":       "kilogram",
    "__GR__":       "gram",
    "__MG__":       "miligram",
    "__MV__":       "milivolt",
    "__KV__":       "kilovolt",
    "__V__":        "volt",
    "__MA__":       "miliampere",
    "__A__":        "ampere",
    "__KW__":       "kilowatt",
    "__W__":        "watt",
    "__OHM__":      "ohm",
    "__GHZ__":      "gigahertz",
    "__MHZ__":      "megahertz",
    "__KHZ__":      "kilohertz",
    "__HZ__":       "hertz",
    "__MSEC__":     "milidetik",
    "__SEC__":      "detik",
    "__GB__":       "gigabyte",
    "__MB__":       "megabyte",
    "__KB__":       "kilobyte",
}


def _make_regex_fn(token: str):
    satuan = _SATUAN_MAP.get(token, token)
    return lambda m: f"{_bilangan_ke_kata(m.group(1))} {satuan}"


# ── Cache compiled rules ──────────────────────────────────────────────────────

_rules_cache: list = []
_kamus_cache: list = []
_cache_dirty = True


def invalidate_cache():
    global _cache_dirty
    _cache_dirty = True


def _load_rules() -> list:
    global _rules_cache, _kamus_cache, _cache_dirty
    if not _cache_dirty:
        return _rules_cache

    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT pattern, replacement, rule_type FROM tts_rules "
            "WHERE active=1 ORDER BY sort_order ASC"
        ).fetchall()
        kamus_rows = conn.execute(
            "SELECT kata_asal, kata_ganti FROM tts_kamus WHERE active=1"
        ).fetchall()

    compiled = []
    for row in rows:
        pattern, replacement, rule_type = row["pattern"], row["replacement"], row["rule_type"]
        try:
            rx = re.compile(pattern)
            if rule_type == "regex_fn":
                repl = _make_regex_fn(replacement)
            else:
                repl = replacement
            compiled.append((rx, repl))
        except re.error:
            pass  # skip invalid pattern

    _kamus_cache = [(r["kata_asal"], r["kata_ganti"]) for r in kamus_rows]
    _rules_cache = compiled
    _cache_dirty = False
    return _rules_cache


# ── Public API ────────────────────────────────────────────────────────────────

def preprocess_tts(text: str) -> str:
    """
    Bersihkan + konversi teks agar dibaca natural oleh edge-tts id-ID.

    Contoh:
        preprocess_tts("Suhu 27,8°C")
        → "Suhu dua puluh tujuh koma delapan derajat selsius"
    """
    rules = _load_rules()
    for pattern, repl in rules:
        text = pattern.sub(repl, text)

    # Terapkan kamus (word-boundary aware)
    for kata_asal, kata_ganti in _kamus_cache:
        text = re.sub(r'\b' + re.escape(kata_asal) + r'\b', kata_ganti, text, flags=re.IGNORECASE)

    text = re.sub(r" {2,}", " ", text).strip()
    return text


async def speak(
    text: str,
    output_path: str,
    voice: str = "id-ID-TutiNeural",
    rate: str = "-10%",
    pitch: str = "-3Hz",
    volume: str = "+0%",
    skip_preprocess: bool = False,
) -> str:
    """
    Wrapper edge-tts dengan preprocessing otomatis.

    Returns: output_path setelah file tersimpan.
    """
    try:
        import edge_tts
    except ImportError:
        raise RuntimeError("edge-tts tidak terinstall. Jalankan: pip install edge-tts")

    processed = text if skip_preprocess else preprocess_tts(text)
    communicate = edge_tts.Communicate(processed, voice=voice, rate=rate, pitch=pitch, volume=volume)
    await communicate.save(output_path)
    return output_path


def speak_sync(text: str, output_path: str, **kwargs) -> str:
    """Versi synchronous dari speak() untuk konteks non-async."""
    return asyncio.run(speak(text, output_path, **kwargs))


# ── CRUD helpers (dipanggil dari tts_admin.py) ────────────────────────────────

def get_all_rules() -> list:
    with _get_conn() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM tts_rules ORDER BY sort_order ASC"
        ).fetchall()]


def get_rule(rule_id: int) -> Optional[dict]:
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM tts_rules WHERE id=?", (rule_id,)).fetchone()
        return dict(row) if row else None


def upsert_rule(data: dict) -> int:
    with _get_conn() as conn:
        if data.get("id"):
            conn.execute("""
                UPDATE tts_rules SET label=?, category=?, pattern=?, replacement=?,
                rule_type=?, sort_order=?, active=? WHERE id=?
            """, (data["label"], data["category"], data["pattern"], data["replacement"],
                  data["rule_type"], data["sort_order"], data["active"], data["id"]))
            rid = data["id"]
        else:
            cur = conn.execute("""
                INSERT INTO tts_rules (label, category, pattern, replacement, rule_type, sort_order, active)
                VALUES (?,?,?,?,?,?,?)
            """, (data["label"], data["category"], data["pattern"], data["replacement"],
                  data["rule_type"], data.get("sort_order", 99), data.get("active", 1)))
            rid = cur.lastrowid
    invalidate_cache()
    return rid


def delete_rule(rule_id: int):
    with _get_conn() as conn:
        conn.execute("DELETE FROM tts_rules WHERE id=?", (rule_id,))
    invalidate_cache()


def toggle_rule(rule_id: int, active: bool):
    with _get_conn() as conn:
        conn.execute("UPDATE tts_rules SET active=? WHERE id=?", (1 if active else 0, rule_id))
    invalidate_cache()


def reorder_rules(ordered_ids: list[int]):
    with _get_conn() as conn:
        for idx, rid in enumerate(ordered_ids):
            conn.execute("UPDATE tts_rules SET sort_order=? WHERE id=?", (idx * 10, rid))
    invalidate_cache()


# Kamus
def get_all_kamus() -> list:
    with _get_conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM tts_kamus ORDER BY kata_asal").fetchall()]


def upsert_kamus(data: dict) -> int:
    with _get_conn() as conn:
        if data.get("id"):
            conn.execute("UPDATE tts_kamus SET kata_asal=?, kata_ganti=?, bahasa=?, active=? WHERE id=?",
                         (data["kata_asal"], data["kata_ganti"], data.get("bahasa", "id"), data["active"], data["id"]))
            rid = data["id"]
        else:
            cur = conn.execute("INSERT INTO tts_kamus (kata_asal, kata_ganti, bahasa, active) VALUES (?,?,?,?)",
                               (data["kata_asal"], data["kata_ganti"], data.get("bahasa", "id"), data.get("active", 1)))
            rid = cur.lastrowid
    invalidate_cache()
    return rid


def delete_kamus(kamus_id: int):
    with _get_conn() as conn:
        conn.execute("DELETE FROM tts_kamus WHERE id=?", (kamus_id,))
    invalidate_cache()


# SSML templates
def get_all_ssml() -> list:
    with _get_conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM tts_ssml ORDER BY nama").fetchall()]


def upsert_ssml(data: dict) -> int:
    with _get_conn() as conn:
        if data.get("id"):
            conn.execute("UPDATE tts_ssml SET nama=?, trigger=?, ssml_wrap=?, active=? WHERE id=?",
                         (data["nama"], data["trigger"], data["ssml_wrap"], data["active"], data["id"]))
            rid = data["id"]
        else:
            cur = conn.execute("INSERT INTO tts_ssml (nama, trigger, ssml_wrap, active) VALUES (?,?,?,?)",
                               (data["nama"], data["trigger"], data["ssml_wrap"], data.get("active", 1)))
            rid = cur.lastrowid
    return rid


def delete_ssml(ssml_id: int):
    with _get_conn() as conn:
        conn.execute("DELETE FROM tts_ssml WHERE id=?", (ssml_id,))


# ── Auto-init saat import ─────────────────────────────────────────────────────
init_db()
