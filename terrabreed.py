"""
TerraBreed v2.0 — Smart Incubator Module
Blueprint Flask yang di-register ke app.py existing.

Fitur:
- MQTT subscriber (paho) → terima data sensor ESP32
- SQLite logging sensor + inkubasi
- Flask-SocketIO push realtime ke dashboard
- AI Assistant (Groq) — Q&A + execute command via MQTT
- Voice: STT (Whisper) + TTS (edge-TTS) sudah pakai endpoint app.py

Cara install dependencies tambahan:
    pip install paho-mqtt flask-socketio --break-system-packages

Cara register ke app.py — tambahkan 3 baris ini di app.py:
    from terrabreed import create_terrabreed_blueprint, init_terrabreed_mqtt
    tb_bp, tb_socketio = create_terrabreed_blueprint(client)
    app.register_blueprint(tb_bp)
    # Di bagian bawah, sebelum app.run():
    init_terrabreed_mqtt(app, tb_socketio)
"""

import json
import logging
import os
import sqlite3
import threading
import time

# ─── TTS preprocessing (tts_utils) ───
try:
    from tts_utils import preprocess_tts, init_db as init_tts_db
    _TTS_UTILS_OK = True
except ImportError:
    _TTS_UTILS_OK = False
    def preprocess_tts(t): return t  # fallback: passthrough
    def init_tts_db(): pass
from datetime import datetime

logger = logging.getLogger(__name__)

# ─── Path database TerraBreed (terpisah dari chat_history.db) ───
TB_DB_PATH = os.path.join(os.path.dirname(__file__), 'terrabreed.db')

# ─── Konfigurasi MQTT ───
MQTT_HOST       = os.environ.get('TB_MQTT_HOST', '10.10.10.1')
MQTT_PORT       = int(os.environ.get('TB_MQTT_PORT', 1883))
MQTT_DEVICE_ID  = os.environ.get('TB_DEVICE_ID', 'incubator_01')

# Topic map
TOPIC_SENSOR    = f"{MQTT_DEVICE_ID}/sensor"
TOPIC_STATUS    = f"{MQTT_DEVICE_ID}/status"
TOPIC_ALARM     = f"{MQTT_DEVICE_ID}/alarm"
TOPIC_CMD       = f"{MQTT_DEVICE_ID}/command"    # publish command ke ESP32
TOPIC_SETTING   = f"{MQTT_DEVICE_ID}/settings"  # publish settings ke ESP32

# ─── State cache (in-memory, update tiap MQTT message) ───
_latest_sensor  = {}   # data sensor terakhir
_latest_status  = {}   # status aktuator terakhir
_state_lock     = threading.Lock()

# ─── System prompt AI TerraBreed ───
TB_SYSTEM_PROMPT = """Kamu adalah TERRA, asisten AI pintar untuk mesin tetas TerraBreed.

KEPRIBADIAN: Ramah, profesional, sabar, dan selalu informatif. Seperti seorang ahli peternakan yang bisa diandalkan.

KEMAMPUAN:
1. Menjawab pertanyaan tentang proses inkubasi, kondisi sensor, dan troubleshooting
2. Mengeksekusi perintah kontrol mesin tetas secara langsung tanpa perlu konfirmasi
3. Membuat atau menutup sesi inkubasi secara langsung tanpa perlu konfirmasi
4. Memberikan saran berdasarkan data sensor real-time

PERINTAH YANG BISA DIEKSEKUSI (gunakan tool execute_command):
- heater: on/off → nyalakan/matikan pemanas
- humidifier: on/off → nyalakan/matikan humidifier  
- fan: on/off → nyalakan/matikan kipas
- spare: on/off → relay cadangan
- turn_now: true → putar rak sekarang
- motor_stop: true → hentikan motor
- auto_mode: true/false → mode otomatis/manual
- target_temp: <nilai> → set target suhu (°C)
- target_humid: <nilai> → set target kelembapan (%)
- reboot: true → reboot ESP32

MEMBUAT SESI INKUBASI (gunakan tool start_incubation):
- Gunakan saat user meminta "buat sesi baru", "mulai inkubasi", atau menyebut jenis telur + jumlah
- Ekstrak: species (nama hewan), total_eggs (jumlah), total_days (lama), notes
- Jika user tidak menyebut lama inkubasi, pakai default referensi di bawah
- Jika user tidak menyebut jumlah, total_eggs = 0
- LANGSUNG EKSEKUSI TANPA TANYA KONFIRMASI

MENUTUP SESI INKUBASI (gunakan tool finish_incubation):
- Gunakan saat user meminta "selesaikan sesi", "tutup inkubasi", atau menyebut hasil penetasan
- Ekstrak: hatched (jumlah menetas), infertile (tidak fertile), notes

REFERENSI PARAMETER INKUBASI:
- Ayam kampung : 37.5°C, 60% RH, 21 hari
- Bebek        : 37.8°C, 65% RH, 28 hari
- Kalkun       : 37.5°C, 60% RH, 28 hari
- Puyuh        : 37.5°C, 60% RH, 17 hari
- Angsa        : 37.6°C, 65% RH, 30 hari
- Buaya        : 32.0°C, 85% RH, 90 hari
- Penyu        : 29.0°C, 80% RH, 60 hari
- Iguana       : 30.0°C, 70% RH, 65 hari
- Ular         : 30.0°C, 70% RH, 60 hari
- Merpati      : 37.5°C, 55% RH, 18 hari
- Merak        : 37.5°C, 60% RH, 28 hari
- Emu          : 36.5°C, 40% RH, 50 hari
- (spesies lain): gunakan nilai yang sesuai berdasarkan pengetahuanmu

PENTING:
- Selalu sebut data sensor aktual saat menjawab pertanyaan kondisi mesin
- Jika suhu/kelembapan di luar batas normal, langsung beri peringatan
- Bahasa Indonesia yang natural dan mudah dipahami peternak
- Jangan bertele-tele, langsung ke intinya
- JANGAN tanya konfirmasi untuk perintah yang sudah jelas dari user
"""

# ─── Tool definition untuk AI command execution ───
TB_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "execute_command",
            "description": "Eksekusi perintah kontrol ke mesin tetas TerraBreed via MQTT",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Nama perintah: heater, humidifier, fan, spare, turn_now, motor_stop, auto_mode, target_temp, target_humid, reboot"
                    },
                    "value": {
                        "description": "Nilai perintah: true/false untuk toggle, atau angka untuk target"
                    }
                },
                "required": ["command", "value"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "start_incubation",
            "description": "Buat sesi inkubasi baru di database. Panggil saat user meminta membuat sesi inkubasi atau menyebut jenis telur yang akan diinkubasi.",
            "parameters": {
                "type": "object",
                "properties": {
                    "species": {
                        "type": "string",
                        "description": "Nama spesies/hewan, misal: ayam, bebek, buaya, penyu, dll"
                    },
                    "total_eggs": {
                        "type": "integer",
                        "description": "Jumlah telur yang diinkubasi. 0 jika tidak disebutkan."
                    },
                    "total_days": {
                        "type": "integer",
                        "description": "Lama masa inkubasi dalam hari sesuai spesies"
                    },
                    "notes": {
                        "type": "string",
                        "description": "Catatan tambahan, boleh kosong"
                    }
                },
                "required": ["species", "total_eggs", "total_days"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "finish_incubation",
            "description": "Tutup/selesaikan sesi inkubasi aktif. Panggil saat user meminta menutup sesi atau menyebut hasil penetasan.",
            "parameters": {
                "type": "object",
                "properties": {
                    "hatched": {
                        "type": "integer",
                        "description": "Jumlah telur yang berhasil menetas"
                    },
                    "infertile": {
                        "type": "integer",
                        "description": "Jumlah telur infertil/tidak menetas"
                    },
                    "notes": {
                        "type": "string",
                        "description": "Catatan hasil inkubasi"
                    }
                },
                "required": ["hatched", "infertile"]
            }
        }
    }
]


# ══════════════════════════════════════════════════════════
#  DATABASE
# ══════════════════════════════════════════════════════════

def get_tb_db():
    conn = sqlite3.connect(TB_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_tb_db():
    with get_tb_db() as conn:
        # Log sensor time-series
        conn.execute('''
            CREATE TABLE IF NOT EXISTS sensor_logs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ts          INTEGER NOT NULL,
                temp        REAL,
                temp_ds1    REAL,
                temp_ds2    REAL,
                temp_sht    REAL,
                humidity    REAL,
                target_temp REAL,
                target_humid REAL,
                heater      INTEGER,
                humidifier  INTEGER,
                fan         INTEGER,
                auto_mode   INTEGER,
                tray_pos    TEXT,
                motor_state TEXT
            )
        ''')
        # Index untuk query cepat berdasarkan waktu
        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_sensor_ts ON sensor_logs(ts DESC)
        ''')
        # Sesi inkubasi
        conn.execute('''
            CREATE TABLE IF NOT EXISTS incubation_sessions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at  INTEGER NOT NULL,
                ended_at    INTEGER,
                species     TEXT DEFAULT 'ayam',
                total_days  INTEGER DEFAULT 21,
                notes       TEXT
            )
        ''')
        # Migrasi: tambah kolom total_eggs / hatched / infertile / source jika DB lama
        for _col, _type, _def in [
            ('total_eggs', 'INTEGER', '0'),
            ('hatched',    'INTEGER', '0'),
            ('infertile',  'INTEGER', '0'),
            ('source',     'TEXT',    "''"),   # TEXT bukan INTEGER agar default string kosong valid
        ]:
            try:
                conn.execute(
                    f"ALTER TABLE incubation_sessions ADD COLUMN {_col} {_type} DEFAULT {_def}"
                )
                logger.info(f"TB DB migrated: added '{_col}' to incubation_sessions")
            except Exception:
                pass  # Kolom sudah ada
        # Log alarm
        conn.execute('''
            CREATE TABLE IF NOT EXISTS alarm_logs (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                ts      INTEGER NOT NULL,
                type    TEXT NOT NULL,
                message TEXT,
                value   REAL
            )
        ''')
        # History chat TerraBreed AI (terpisah dari chat Jangkrik)
        conn.execute('''
            CREATE TABLE IF NOT EXISTS tb_chat_history (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                ts      INTEGER NOT NULL,
                role    TEXT NOT NULL,
                content TEXT NOT NULL
            )
        ''')
        conn.commit()
    logger.info("✅ TerraBreed DB initialized: " + TB_DB_PATH)


# ══════════════════════════════════════════════════════════
#  MQTT PUBLISH HELPER
# ══════════════════════════════════════════════════════════

_mqtt_client = None


# Pemetaan nama command/setting dari Python → nama cmd ESP32
# ESP32 mqttCallback membaca key "cmd" dan "value" dari JSON
_CMD_ALIASES: dict = {
    # Aktuator toggle
    'heater':            'heater',
    'humidifier':        'humidifier',
    'fan':               'fan',
    'spare':             'spare',
    # Kontrol motor
    'turn_now':          'turn_now',
    'motor_stop':        'motor_stop',
    'motor_forward':     'motor_forward',
    'motor_reverse':     'motor_reverse',
    # Mode & target
    'auto_mode':         'set_auto',
    'target_temp':       'set_temp',
    'target_humid':      'set_humid',
    # Jadwal balik telur
    'interval':          'set_turn_interval',
    'turn_interval_min': 'set_turn_interval',
    'duration':          'set_turn_duration',
    'turn_duration_sec': 'set_turn_duration',
    'stop_day':          'set_stop_turning_day',
    # Inkubasi & sistem
    'start_incubation':  'start_incubation',
    'reboot':            'reboot',
}


def publish_command(command: str, value):
    """
    Publish command ke ESP32 via MQTT.

    ESP32 mqttCallback mengharapkan format: {"cmd": "<nama>", "value": <nilai>}
    Sebelumnya kode ini mengirim {command: value} sehingga ESP32 mengabaikan
    semua perintah karena tidak ada key "cmd" dalam JSON.
    """
    global _mqtt_client
    if _mqtt_client is None:
        logger.warning("[TerraBreed] MQTT client belum siap")
        return False
    try:
        esp_cmd = _CMD_ALIASES.get(command, command)
        # Normalkan value string "on"/"off" ke bool agar ArduinoJson as<bool>() bekerja
        if isinstance(value, str):
            if value.lower() == 'on':
                value = True
            elif value.lower() == 'off':
                value = False
        payload = json.dumps({"cmd": esp_cmd, "value": value})
        _mqtt_client.publish(TOPIC_CMD, payload, qos=1)
        logger.info(f"[TerraBreed CMD] {TOPIC_CMD} → {payload}")
        return True
    except Exception as e:
        logger.error(f"[TerraBreed] publish_command error: {e}")
        return False


def publish_setting(key: str, value):
    """
    Publish setting (target suhu/humid, interval, PID, dll) ke ESP32.

    Sebelumnya kode ini mempublikasikan ke TOPIC_SETTING (incubator_01/settings)
    padahal ESP32 hanya subscribe ke TOPIC_CMD (incubator_01/command). Kini
    setting dikirim ke TOPIC_CMD dengan format {"cmd": ..., "value": ...} agar
    diterima oleh ESP32 mqttCallback.

    Khusus PID (pid_kp/pid_ki/pid_kd): ESP32 membaca key kp/ki/kd langsung
    dari payload set_pid sehingga dikirim sebagai {"cmd":"set_pid","kp":<val>}.
    """
    global _mqtt_client
    if _mqtt_client is None:
        return False
    try:
        if key in ('pid_kp', 'pid_ki', 'pid_kd'):
            pid_key = key[4:]  # 'kp', 'ki', atau 'kd'
            payload = json.dumps({"cmd": "set_pid", pid_key: value})
        else:
            esp_cmd = _CMD_ALIASES.get(key, key)
            payload = json.dumps({"cmd": esp_cmd, "value": value})
        _mqtt_client.publish(TOPIC_CMD, payload, qos=1)
        logger.info(f"[TerraBreed SET] {TOPIC_CMD} → {payload}")
        return True
    except Exception as e:
        logger.error(f"[TerraBreed] publish_setting error: {e}")
        return False


# ══════════════════════════════════════════════════════════
#  AI ASSISTANT
# ══════════════════════════════════════════════════════════

# In-memory conversation history untuk TerraBreed AI
_tb_history      = []
_tb_history_lock = threading.Lock()


def get_active_incubation_context() -> str:
    """
    Baca sesi inkubasi aktif dari DB dan buat string konteks untuk AI.
    Termasuk spesies, jumlah telur, tanggal mulai, hari ke-berapa, sisa hari, dan catatan.
    """
    try:
        with get_tb_db() as conn:
            row = conn.execute(
                '''SELECT id, started_at, species, total_days, total_eggs, hatched, infertile, notes
                   FROM incubation_sessions
                   WHERE ended_at IS NULL
                   ORDER BY started_at DESC LIMIT 1'''
            ).fetchone()
    except Exception:
        # Kolom total_eggs/hatched/infertile mungkin belum ada di DB lama — fallback query minimal
        try:
            with get_tb_db() as conn:
                row = conn.execute(
                    '''SELECT id, started_at, species, total_days, NULL as total_eggs,
                              NULL as hatched, NULL as infertile, notes
                       FROM incubation_sessions
                       WHERE ended_at IS NULL
                       ORDER BY started_at DESC LIMIT 1'''
                ).fetchone()
        except Exception:
            row = None

    if not row:
        return "=== SESI INKUBASI ===\nTidak ada sesi inkubasi aktif."

    import datetime as _dt

    SPECIES_LABEL = {
        'ayam':   'Ayam Kampung',
        'bebek':  'Bebek',
        'kalkun': 'Kalkun',
        'puyuh':  'Puyuh',
        'angsa':  'Angsa',
    }
    SPECIES_PARAMS = {
        'ayam':   {'temp': 37.5, 'humid': 60,  'days': 21},
        'bebek':  {'temp': 37.8, 'humid': 65,  'days': 28},
        'kalkun': {'temp': 37.5, 'humid': 60,  'days': 28},
        'puyuh':  {'temp': 37.5, 'humid': 60,  'days': 17},
        'angsa':  {'temp': 37.6, 'humid': 65,  'days': 30},
    }

    sp_key      = row['species'] or 'ayam'
    sp_label    = SPECIES_LABEL.get(sp_key, sp_key.capitalize())
    sp_params   = SPECIES_PARAMS.get(sp_key, {})
    total_days  = row['total_days'] or sp_params.get('days', 21)
    started_ts  = row['started_at']
    started_dt  = _dt.datetime.fromtimestamp(started_ts)
    started_str = started_dt.strftime('%d %B %Y, %H:%M')
    now_ts      = int(time.time())
    elapsed_sec = now_ts - started_ts
    elapsed_day = int(elapsed_sec // 86400)
    sisa_hari   = max(0, total_days - elapsed_day)
    perkiraan_tetas = _dt.datetime.fromtimestamp(started_ts + total_days * 86400).strftime('%d %B %Y')

    total_eggs  = row['total_eggs']
    hatched     = row['hatched']
    infertile   = row['infertile']
    notes       = row['notes'] or '-'

    lines = [
        "=== SESI INKUBASI AKTIF ===",
        f"Spesies      : {sp_label}",
    ]
    if total_eggs is not None:
        lines.append(f"Jumlah telur : {total_eggs} butir")
    if hatched is not None:
        lines.append(f"Telur menetas: {hatched} butir")
    if infertile is not None:
        lines.append(f"Infertil     : {infertile} butir")
    lines += [
        f"Mulai        : {started_str}",
        f"Hari ke-     : {elapsed_day} dari {total_days} hari",
        f"Sisa hari    : {sisa_hari} hari",
        f"Perkiraan tetas: {perkiraan_tetas}",
        f"Target suhu  : {sp_params.get('temp', '--')}°C",
        f"Target humid : {sp_params.get('humid', '--')}%",
        f"Catatan      : {notes}",
    ]
    return "\n".join(lines)


def get_sensor_context() -> str:
    """Buat string konteks lengkap untuk AI: sensor + aktuator + sesi inkubasi."""
    with _state_lock:
        s = dict(_latest_sensor)
        st = dict(_latest_status)

    lines = []

    # ── Sesi inkubasi aktif (dari DB) ──
    lines.append(get_active_incubation_context())

    if not s and not st:
        lines.append("\nData sensor belum tersedia (menunggu koneksi ESP32).")
        return "\n".join(lines)

    if s:
        lines.append("\n=== DATA SENSOR REAL-TIME ===")
        lines.append(f"Suhu aktif   : {s.get('temp', '--')}°C")
        lines.append(f"DS18B20 #1   : {s.get('temp_ds1', '--')}°C")
        lines.append(f"DS18B20 #2   : {s.get('temp_ds2', '--')}°C")
        lines.append(f"SHT31        : {s.get('temp_sht', '--')}°C")
        lines.append(f"Kelembapan   : {s.get('humidity', '--')}%")
        lines.append(f"Target suhu  : {s.get('target_temp', '--')}°C")
        lines.append(f"Target lembap: {s.get('target_humid', '--')}%")

        # ── Evaluasi otomatis: bandingkan sensor vs target, buat peringatan eksplisit ──
        warnings = []
        try:
            temp        = float(s['temp'])        if s.get('temp')         is not None else None
            target_temp = float(s['target_temp']) if s.get('target_temp')  is not None else None
            humid       = float(s['humidity'])    if s.get('humidity')     is not None else None
            target_hum  = float(s['target_humid'])if s.get('target_humid') is not None else None

            if temp is not None and target_temp is not None:
                diff = temp - target_temp
                if abs(diff) >= 0.5:
                    arah = "TERLALU RENDAH" if diff < 0 else "TERLALU TINGGI"
                    severity = "KRITIS" if abs(diff) >= 2.0 else "BAHAYA"
                    warnings.append(
                        f"[{severity}] SUHU {arah}: {temp:.1f}°C vs target {target_temp:.1f}°C "
                        f"(selisih {abs(diff):.1f}°C)"
                    )

            if humid is not None and target_hum is not None:
                diff = humid - target_hum
                if abs(diff) >= 3.0:
                    arah = "TERLALU RENDAH" if diff < 0 else "TERLALU TINGGI"
                    severity = "KRITIS" if abs(diff) >= 10.0 else "BAHAYA"
                    warnings.append(
                        f"[{severity}] KELEMBAPAN {arah}: {humid:.1f}% vs target {target_hum:.1f}% "
                        f"(selisih {abs(diff):.1f}%)"
                    )
        except Exception:
            pass

        if warnings:
            lines.append("\n=== ⚠️ PERINGATAN KONDISI MESIN ===")
            for w in warnings:
                lines.append(w)
            lines.append(">> Sampaikan peringatan ini kepada user dan jelaskan dampaknya terhadap penetasan!")

    if st:
        lines.append("\n=== STATUS AKTUATOR ===")
        lines.append(f"Pemanas   : {'ON' if st.get('heater') else 'OFF'}")
        lines.append(f"Humidifier: {'ON' if st.get('humidifier') else 'OFF'}")
        lines.append(f"Kipas     : {'ON' if st.get('fan') else 'OFF'}")
        lines.append(f"Mode      : {'Otomatis' if st.get('auto_mode') else 'Manual'}")
        tray_raw = st.get('tray_tilted')
        if tray_raw is None:
            tray_str = st.get('tray_position', '--')
        else:
            tray_str = 'Kiri (-45°)' if tray_raw else 'Kanan (+45°)'
        motor_str = st.get('motor_state', 'stop')
        lines.append(f"Posisi rak  : {tray_str}")
        lines.append(f"Motor state : {motor_str}")
        if st.get('turn_interval_min') is not None:
            lines.append(f"Interval balik rak: {st.get('turn_interval_min')} menit")
        if st.get('turn_duration_sec') is not None:
            lines.append(f"Durasi motor: {st.get('turn_duration_sec')} detik")
    return "\n".join(lines)


# ─── Kata kunci yang menandakan aksi/perintah (trigger tool_choice=required) ───
_ACTION_KEYWORDS = [
    # start incubation
    'buat sesi', 'mulai inkubasi', 'mulai sesi', 'buat inkubasi', 'inkubasi baru',
    'start inkubasi', 'telur', 'tetaskan', 'mau inkubasi', 'mau buat', 'buat sesi baru',
    # finish incubation
    'selesai', 'tutup sesi', 'tutup inkubasi', 'finish', 'akhiri', 'sesi selesai',
    'sudah menetas', 'hasil penetasan', 'penetasan selesai', 'close sesi',
    # execute commands
    'nyalakan', 'matikan', 'hidupkan', 'aktifkan', 'nonaktifkan',
    'putar', 'reboot', 'restart', 'set suhu', 'set target', 'set kelembapan',
    'auto mode', 'mode manual', 'mode otomatis',
    'heater', 'humidifier', 'kipas', 'fan', 'motor',
]

def _is_action_message(msg: str) -> bool:
    """Deteksi apakah pesan user berniat melakukan aksi (bukan sekedar tanya)."""
    m = msg.lower()
    return any(kw in m for kw in _ACTION_KEYWORDS)


def tb_ai_chat(groq_client, user_message: str, session_ctx: str = '') -> dict:
    """
    Proses pesan user ke AI TerraBreed.
    session_ctx: konteks sesi inkubasi dari dashboard (opsional, memperkaya konteks DB)
    Return: { reply, commands_executed }
    """
    sensor_ctx = get_sensor_context()
    # Jika dashboard mengirim ctx lebih lengkap (ada jumlah telur, dll), gabungkan
    if session_ctx and session_ctx.strip():
        ctx_combined = sensor_ctx + f"\n\n=== KONTEKS DARI DASHBOARD ===\n{session_ctx.strip()}"
    else:
        ctx_combined = sensor_ctx
    system_with_ctx = TB_SYSTEM_PROMPT + f"\n\n{ctx_combined}"

    with _tb_history_lock:
        _tb_history.append({"role": "user", "content": user_message})
        messages = [{"role": "system", "content": system_with_ctx}] + list(_tb_history)

    commands_executed = []

    try:
        # Panggil Groq dengan tool calling
        response = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=messages,
            tools=TB_TOOLS,
            # required=paksa tool jika ada kata kunci aksi; auto=boleh jawab teks untuk pertanyaan
            tool_choice="required" if _is_action_message(user_message) else "auto",
            max_tokens=1024
        )

        msg = response.choices[0].message
        tool_calls = getattr(msg, 'tool_calls', None) or []

        # Eksekusi semua tool calls
        if tool_calls:
            tool_results = []
            for tc in tool_calls:
                fn        = tc.function
                tool_name = fn.name
                args      = json.loads(fn.arguments)

                # ── Tool: execute_command (MQTT ke ESP32) ──────────────
                if tool_name == 'execute_command':
                    cmd = args.get('command', '')
                    val = args.get('value')
                    setting_keys = {'target_temp', 'target_humid', 'interval', 'duration', 'turn_interval_min', 'turn_duration_sec'}
                    if cmd in setting_keys:
                        ok = publish_setting(cmd, val)
                    else:
                        ok = publish_command(cmd, val)
                    result_str = f"Perintah '{cmd}={val}' berhasil dikirim." if ok else f"Gagal mengirim '{cmd}'."
                    commands_executed.append({"command": cmd, "value": val, "ok": ok})

                # ── Tool: start_incubation (buat sesi DB) ──────────────
                elif tool_name == 'start_incubation':
                    species    = str(args.get('species', 'tidak diketahui')).lower().strip()
                    total_eggs = int(args.get('total_eggs', 0) or 0)
                    total_days = int(args.get('total_days', 21) or 21)
                    notes      = str(args.get('notes', '') or '')
                    now_ts     = int(time.time())
                    try:
                        with get_tb_db() as conn:
                            # Tutup sesi aktif yang masih terbuka
                            conn.execute(
                                'UPDATE incubation_sessions SET ended_at=? WHERE ended_at IS NULL',
                                (now_ts,)
                            )
                            conn.execute(
                                '''INSERT INTO incubation_sessions
                                   (started_at, species, total_days, total_eggs, notes)
                                   VALUES (?,?,?,?,?)''',
                                (now_ts, species, total_days, total_eggs, notes)
                            )
                            new_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
                            conn.commit()
                        publish_command('start_incubation', True)
                        import datetime as _dt
                        started_str = _dt.datetime.fromtimestamp(now_ts).strftime('%d %B %Y %H:%M')
                        result_str = (
                            f"Sesi inkubasi #{new_id} berhasil dibuat: {species}, "
                            f"{total_eggs} telur, {total_days} hari. Mulai: {started_str}."
                        )
                        commands_executed.append({"command": "start_incubation", "value": species, "ok": True})
                        logger.info(f"[TerraBreed AI] Sesi inkubasi dibuat: id={new_id} species={species} eggs={total_eggs} days={total_days}")
                    except Exception as e_sess:
                        result_str = f"Gagal membuat sesi inkubasi: {e_sess}"
                        commands_executed.append({"command": "start_incubation", "value": species, "ok": False})
                        logger.error(f"[TerraBreed AI] start_incubation error: {e_sess}")

                # ── Tool: finish_incubation (tutup sesi aktif) ─────────
                elif tool_name == 'finish_incubation':
                    hatched   = int(args.get('hatched',   0) or 0)
                    infertile = int(args.get('infertile', 0) or 0)
                    notes     = str(args.get('notes', '') or '')
                    now_ts    = int(time.time())
                    try:
                        with get_tb_db() as conn:
                            row = conn.execute(
                                '''SELECT id, species, total_eggs FROM incubation_sessions
                                   WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1'''
                            ).fetchone()
                            if row:
                                conn.execute(
                                    '''UPDATE incubation_sessions
                                       SET ended_at=?, hatched=?, infertile=?, notes=?
                                       WHERE id=?''',
                                    (now_ts, hatched, infertile, notes, row['id'])
                                )
                                conn.commit()
                                # stop_incubation tidak perlu dikirim ke ESP32 (inkubasi lanjut berjalan)
                                result_str = (
                                    f"Sesi inkubasi #{row['id']} ({row['species']}) selesai. "
                                    f"Menetas: {hatched}, infertil: {infertile}."
                                )
                                commands_executed.append({"command": "finish_incubation", "value": row['id'], "ok": True})
                            else:
                                result_str = "Tidak ada sesi inkubasi aktif yang bisa ditutup."
                                commands_executed.append({"command": "finish_incubation", "value": None, "ok": False})
                    except Exception as e_fin:
                        result_str = f"Gagal menutup sesi: {e_fin}"
                        commands_executed.append({"command": "finish_incubation", "value": None, "ok": False})
                        logger.error(f"[TerraBreed AI] finish_incubation error: {e_fin}")

                else:
                    result_str = f"Tool '{tool_name}' tidak dikenal."

                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result_str
                })

            # Lanjutkan conversation dengan hasil tool
            messages2 = messages + [
                {"role": "assistant", "content": msg.content or "", "tool_calls": [
                    {"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in tool_calls
                ]},
                *tool_results
            ]
            response2 = groq_client.chat.completions.create(
                model="meta-llama/llama-4-scout-17b-16e-instruct",
                messages=messages2,
                max_tokens=512
            )
            ai_reply = response2.choices[0].message.content or ""
        else:
            ai_reply = msg.content or ""

        # Simpan ke history
        with _tb_history_lock:
            _tb_history.append({"role": "assistant", "content": ai_reply})
            # Batasi history agar tidak membengkak (simpan 20 pesan terakhir)
            if len(_tb_history) > 40:
                _tb_history[:] = _tb_history[-40:]

        # Simpan ke DB
        now = int(time.time())
        with get_tb_db() as conn:
            conn.execute(
                "INSERT INTO tb_chat_history (ts, role, content) VALUES (?,?,?)",
                (now, "user", user_message)
            )
            conn.execute(
                "INSERT INTO tb_chat_history (ts, role, content) VALUES (?,?,?)",
                (now, "assistant", ai_reply)
            )
            conn.commit()

        return {"reply": ai_reply, "commands_executed": commands_executed}

    except Exception as e:
        logger.error(f"[TerraBreed AI] error: {e}")
        with _tb_history_lock:
            if _tb_history and _tb_history[-1]["role"] == "user":
                _tb_history.pop()
        return {"reply": f"Maaf, terjadi kesalahan: {str(e)}", "commands_executed": []}


# ══════════════════════════════════════════════════════════
#  SELF-DIAGNOSTIC — AI membaca kode sumbernya sendiri
# ══════════════════════════════════════════════════════════

def tb_ai_diagnose(groq_client) -> dict:
    """
    Baca ketiga file sumber TerraBreed (py, html, ino) lalu minta AI
    melakukan audit kode penuh dan melaporkan bug/inkonsistensi.
    File .ino mungkin tidak ada di server (ada di mesin ESP32 developer).
    Mengembalikan { reply, commands_executed, mode:'diagnose' }
    """
    import re as _re

    base = os.path.dirname(os.path.abspath(__file__))
    sources: dict[str, str] = {}

    for fname in ['terrabreed.py', 'terrabreed.html', 'incubator_main.ino']:
        fpath = os.path.join(base, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as fh:
                raw = fh.read()
            # Hapus data URI base64 (logo, favicon) agar tidak membuang token
            raw = _re.sub(
                r'data:image/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]{80,}',
                '[BASE64_IMAGE_DIHAPUS]',
                raw
            )
            sources[fname] = raw
            logger.info(
                f'[TerraBreed Diagnose] Membaca {fname}: {len(raw)} chars (setelah strip base64)'
            )
        except FileNotFoundError:
            sources[fname] = f'[File {fname} tidak ditemukan di direktori server — ini normal untuk file .ino]'
        except Exception as exc:
            sources[fname] = f'[Gagal membaca {fname}: {exc}]'

    total_chars = sum(len(v) for v in sources.values())
    logger.info(
        f'[TerraBreed Diagnose] Total konteks: ~{total_chars} chars '
        f'(~{total_chars // 4} token estimasi). Model: llama-4-scout-17b (128K ctx)'
    )

    diag_prompt = f"""Kamu adalah senior software engineer dan IoT code auditor untuk sistem TerraBreed \
(mesin tetas telur cerdas berbasis ESP32 + Flask Blueprint + MQTT + Socket.IO + SQLite + Groq AI).

Berikut adalah kode sumber lengkap dari tiga file utama sistem:

=== FILE 1: terrabreed.py — Backend (Flask Blueprint, Socket.IO, MQTT subscriber/publisher, SQLite, Groq AI tool-calling) ===
{sources['terrabreed.py']}

=== FILE 2: terrabreed.html — Frontend Dashboard (HTML + CSS + Vanilla JS, Chart.js, Socket.IO client, Web Speech API) ===
{sources['terrabreed.html']}

=== FILE 3: incubator_main.ino — ESP32 Arduino Sketch (MQTT publisher, DHT22/DS18B20 sensor, relay aktuator, EEPROM config) ===
{sources['incubator_main.ino']}

---
Lakukan audit kode penuh. Laporan harus menggunakan format berikut PERSIS:

## 🔴 BUG KRITIS
(bug yang menyebabkan crash, data loss, atau malfungsi serius — wajib cantumkan nama file & nomor baris)

## 🟠 BUG SEDANG
(bug yang menyebabkan perilaku salah namun tidak crash)

## 🟡 PERINGATAN & INKONSISTENSI
(ketidakcocokan topic MQTT antara .py/.html/.ino, field JSON berbeda, race condition, data tidak sinkron)

## 🟢 REKOMENDASI PERBAIKAN
(keamanan, performa, keterbacaan kode — singkat dan konkret, max 8 poin)

## ✅ RINGKASAN AKHIR
(total temuan per kategori + penilaian kesehatan kode: Baik / Perlu Perbaikan / Kritis)

Gunakan Bahasa Indonesia. Cantumkan nama file dan nomor baris untuk setiap temuan."""

    try:
        response = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": diag_prompt}],
            max_tokens=4096,
            temperature=0.1,   # deterministik untuk audit
        )
        reply = response.choices[0].message.content or "Tidak ada respons dari AI."
        logger.info(f'[TerraBreed Diagnose] Selesai. Panjang laporan: {len(reply)} chars')
    except Exception as exc:
        reply = f"⚠️ Gagal menjalankan diagnosa AI: {exc}"
        logger.error(f'[TerraBreed Diagnose] Error: {exc}')

    return {"reply": reply, "commands_executed": [], "mode": "diagnose"}


# ══════════════════════════════════════════════════════════
#  BLUEPRINT FACTORY
# ══════════════════════════════════════════════════════════

def create_terrabreed_blueprint(groq_client):
    """
    Buat Flask Blueprint TerraBreed.
    Return: (blueprint, socketio_instance)
    """
    from flask import Blueprint, jsonify, request, render_template
    from flask_socketio import SocketIO

    tb_bp = Blueprint('terrabreed', __name__, url_prefix='/terrabreed')
    socketio = SocketIO()   # akan di-init ulang dengan app nanti

    init_tb_db()
    init_tts_db()  # inisialisasi DB rules TTS

    # ─── CORS: tambahkan header ke semua response blueprint ───
    @tb_bp.after_request
    def add_cors_headers(response):
        response.headers['Access-Control-Allow-Origin']  = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        return response

    # ─── CORS: tangani preflight OPTIONS untuk semua path di blueprint ───
    @tb_bp.route('/<path:dummy>', methods=['OPTIONS'])
    @tb_bp.route('/', methods=['OPTIONS'])
    def handle_options(dummy=None):
        from flask import Response as _Resp
        r = _Resp('', status=204)
        r.headers['Access-Control-Allow-Origin']  = '*'
        r.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        r.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        r.headers['Access-Control-Max-Age']       = '86400'
        return r

    # ─── Dashboard ───
    @tb_bp.route('/')
    @tb_bp.route('/dashboard')
    def dashboard():
        return render_template('terrabreed.html')

    # ─── Widget JS (embeddable chat widget) ───
    @tb_bp.route('/static/widget.js')
    def widget_js():
        import os
        from flask import Response, current_app
        # Cari widget.js: 1) folder templates/, 2) folder static/, 3) root app
        search_paths = [
            os.path.join(current_app.template_folder or 'templates', 'widget.js'),
            os.path.join(current_app.static_folder   or 'static',    'widget.js'),
            os.path.join(os.path.dirname(__file__), 'widget.js'),
            'widget.js',
        ]
        for path in search_paths:
            if os.path.isfile(path):
                with open(path, 'r', encoding='utf-8') as f:
                    js = f.read()
                resp = Response(js, mimetype='application/javascript')
                resp.headers['Access-Control-Allow-Origin'] = '*'
                resp.headers['Cache-Control'] = 'public, max-age=300'
                return resp
        return Response('// widget.js not found', mimetype='application/javascript', status=404)

    # ─── API: data sensor terbaru ───
    @tb_bp.route('/api/sensor/latest')
    def api_sensor_latest():
        with _state_lock:
            return jsonify({
                "sensor": dict(_latest_sensor),
                "status": dict(_latest_status)
            })

    # ─── API: history sensor (grafik) ───
    @tb_bp.route('/api/sensor/history')
    def api_sensor_history():
        minutes = int(request.args.get('minutes', 60))
        since   = int(time.time()) - (minutes * 60)
        with get_tb_db() as conn:
            rows = conn.execute('''
                SELECT ts, temp, temp_ds1, temp_ds2, temp_sht, humidity,
                       target_temp, target_humid, heater, humidifier, fan
                FROM sensor_logs
                WHERE ts >= ?
                ORDER BY ts ASC
            ''', (since,)).fetchall()
        return jsonify([dict(r) for r in rows])

    # ─── API: statistik harian ───
    @tb_bp.route('/api/sensor/stats')
    def api_sensor_stats():
        since = int(time.time()) - 86400  # 24 jam
        with get_tb_db() as conn:
            row = conn.execute('''
                SELECT
                    AVG(temp)     as avg_temp,
                    MIN(temp)     as min_temp,
                    MAX(temp)     as max_temp,
                    AVG(humidity) as avg_humid,
                    MIN(humidity) as min_humid,
                    MAX(humidity) as max_humid,
                    COUNT(*)      as data_points
                FROM sensor_logs WHERE ts >= ?
            ''', (since,)).fetchone()
        return jsonify(dict(row) if row else {})

    # ─── API: log alarm ───
    @tb_bp.route('/api/alarms')
    def api_alarms():
        limit = int(request.args.get('limit', 50))
        with get_tb_db() as conn:
            rows = conn.execute(
                'SELECT * FROM alarm_logs ORDER BY ts DESC LIMIT ?', (limit,)
            ).fetchall()
        return jsonify([dict(r) for r in rows])

    # ─── API: AI chat ───
    @tb_bp.route('/api/chat', methods=['POST'])
    def api_chat():
        data        = request.get_json() or {}
        message     = data.get('message', '').strip()
        session_ctx = data.get('session_ctx', '').strip()
        if not message:
            return jsonify({"error": "Pesan kosong"}), 400
        result = tb_ai_chat(groq_client, message, session_ctx)
        return jsonify(result)

    # ─── API: clear chat history (in-memory + SQLite DB) ───
    @tb_bp.route('/api/chat/clear', methods=['POST'])
    def api_chat_clear():
        with _tb_history_lock:
            _tb_history.clear()
        # Hapus juga dari SQLite agar history benar-benar terhapus permanen
        deleted_rows = 0
        try:
            with get_tb_db() as conn:
                cur = conn.execute('DELETE FROM tb_chat_history')
                deleted_rows = cur.rowcount
                conn.commit()
        except Exception as e:
            logger.error(f"[TerraBreed] Clear chat DB error: {e}")
        return jsonify({"status": "ok", "deleted_db": deleted_rows})

    # ─── API: diagnosa kode sumber (AI membaca .py + .html + .ino) ───
    @tb_bp.route('/api/diagnose', methods=['POST', 'OPTIONS'])
    def api_diagnose():
        if request.method == 'OPTIONS':
            return '', 204
        result = tb_ai_diagnose(groq_client)
        return jsonify(result)

    # ─── API: chat history dari DB ───
    @tb_bp.route('/api/chat/history')
    def api_chat_history():
        limit = int(request.args.get('limit', 50))
        with get_tb_db() as conn:
            rows = conn.execute(
                'SELECT ts, role, content FROM tb_chat_history ORDER BY ts DESC LIMIT ?',
                (limit,)
            ).fetchall()
        return jsonify([dict(r) for r in rows])
    # ─── API: chat feedback (thumbs up/down per pesan) ───
    @tb_bp.route('/api/chat/feedback', methods=['POST'])
    def api_chat_feedback():
        data     = request.get_json() or {}
        msg_ts   = data.get('msg_ts')    # Unix timestamp pesan (int)
        content  = data.get('content', '')
        feedback = data.get('feedback')  # 'up', 'down', atau None (hapus)
        if not msg_ts:
            return jsonify({"error": "msg_ts diperlukan"}), 400
        now = int(time.time())
        try:
            with get_tb_db() as conn:
                # Buat tabel jika belum ada
                conn.execute('''
                    CREATE TABLE IF NOT EXISTS tb_chat_feedback (
                        id        INTEGER PRIMARY KEY AUTOINCREMENT,
                        ts        INTEGER NOT NULL,
                        msg_ts    INTEGER NOT NULL,
                        feedback  TEXT,
                        content   TEXT
                    )
                ''')
                # Upsert: hapus feedback lama untuk msg_ts ini dulu, lalu insert baru
                conn.execute('DELETE FROM tb_chat_feedback WHERE msg_ts = ?', (msg_ts,))
                if feedback in ('up', 'down'):
                    conn.execute(
                        'INSERT INTO tb_chat_feedback (ts, msg_ts, feedback, content) VALUES (?,?,?,?)',
                        (now, msg_ts, feedback, content)
                    )
                conn.commit()
            logger.info(f"[TerraBreed Feedback] msg_ts={msg_ts} feedback={feedback}")
            return jsonify({"ok": True})
        except Exception as e:
            logger.error(f"[TerraBreed Feedback] error: {e}")
            return jsonify({"error": str(e)}), 500

    # ─── API: feedback analytics — statistik thumbs per hari dan per sesi ───
    @tb_bp.route('/api/chat/feedback/analytics')
    def api_chat_feedback_analytics():
        days = max(1, min(int(request.args.get('days', 7)), 365))
        since = int(time.time()) - (days * 86400)
        try:
            with get_tb_db() as conn:
                # Pastikan tabel ada
                conn.execute('''
                    CREATE TABLE IF NOT EXISTS tb_chat_feedback (
                        id        INTEGER PRIMARY KEY AUTOINCREMENT,
                        ts        INTEGER NOT NULL,
                        msg_ts    INTEGER NOT NULL,
                        feedback  TEXT,
                        content   TEXT
                    )
                ''')

                # Statistik keseluruhan selama periode
                overall_row = conn.execute('''
                    SELECT
                        COUNT(*)   AS total_rated,
                        SUM(CASE WHEN feedback = 'up'   THEN 1 ELSE 0 END) AS thumbs_up,
                        SUM(CASE WHEN feedback = 'down' THEN 1 ELSE 0 END) AS thumbs_down,
                        ROUND(
                            100.0 * SUM(CASE WHEN feedback = 'up' THEN 1 ELSE 0 END)
                            / NULLIF(COUNT(*), 0), 1
                        ) AS positive_pct
                    FROM tb_chat_feedback
                    WHERE ts >= ? AND feedback IS NOT NULL
                ''', (since,)).fetchone()

                # Statistik per hari (gunakan timezone lokal server)
                daily_rows = conn.execute('''
                    SELECT
                        date(ts, 'unixepoch', 'localtime') AS day,
                        COUNT(*)   AS total_rated,
                        SUM(CASE WHEN feedback = 'up'   THEN 1 ELSE 0 END) AS thumbs_up,
                        SUM(CASE WHEN feedback = 'down' THEN 1 ELSE 0 END) AS thumbs_down,
                        ROUND(
                            100.0 * SUM(CASE WHEN feedback = 'up' THEN 1 ELSE 0 END)
                            / NULLIF(COUNT(*), 0), 1
                        ) AS positive_pct
                    FROM tb_chat_feedback
                    WHERE ts >= ? AND feedback IS NOT NULL
                    GROUP BY day
                    ORDER BY day DESC
                ''', (since,)).fetchall()

                # Statistik per sesi inkubasi
                # Join berdasarkan msg_ts (timestamp pesan) masuk dalam rentang waktu sesi
                try:
                    session_rows = conn.execute('''
                        SELECT
                            s.id           AS session_id,
                            s.species,
                            s.started_at,
                            s.ended_at,
                            s.total_eggs,
                            COUNT(f.id)    AS total_rated,
                            SUM(CASE WHEN f.feedback = 'up'   THEN 1 ELSE 0 END) AS thumbs_up,
                            SUM(CASE WHEN f.feedback = 'down' THEN 1 ELSE 0 END) AS thumbs_down,
                            ROUND(
                                100.0 * SUM(CASE WHEN f.feedback = 'up' THEN 1 ELSE 0 END)
                                / NULLIF(COUNT(f.id), 0), 1
                            ) AS positive_pct
                        FROM incubation_sessions s
                        LEFT JOIN tb_chat_feedback f
                            ON  f.msg_ts >= s.started_at
                            AND (s.ended_at IS NULL OR f.msg_ts <= s.ended_at)
                            AND f.feedback IS NOT NULL
                        GROUP BY s.id
                        ORDER BY s.started_at DESC
                        LIMIT 20
                    ''').fetchall()
                except Exception as e_sess:
                    logger.warning(f"[TerraBreed Analytics] per-session query error: {e_sess}")
                    session_rows = []

            overall = dict(overall_row) if overall_row else {
                "total_rated": 0, "thumbs_up": 0, "thumbs_down": 0, "positive_pct": None
            }
            return jsonify({
                "period_days":  days,
                "overall":      overall,
                "daily":        [dict(r) for r in daily_rows],
                "per_session":  [dict(r) for r in session_rows],
            })
        except Exception as e:
            logger.error(f"[TerraBreed Feedback Analytics] error: {e}")
            return jsonify({"error": str(e)}), 500

    # ─── API: publish command manual (dari dashboard tombol) ───
    @tb_bp.route('/api/command', methods=['POST'])
    def api_command():
        data    = request.get_json() or {}
        command = data.get('command', '')
        value   = data.get('value')
        if not command:
            return jsonify({"error": "Command kosong"}), 400
        setting_keys = {'target_temp', 'target_humid', 'interval', 'duration', 'turn_interval_min', 'turn_duration_sec'}
        if command in setting_keys:
            ok = publish_setting(command, value)
        else:
            ok = publish_command(command, value)
        return jsonify({"ok": ok, "command": command, "value": value})

    # ─── API: incubation session ───
    @tb_bp.route('/api/incubation/start', methods=['POST'])
    def api_incubation_start():
        data       = request.get_json() or {}
        species    = data.get('species', 'ayam')
        days       = data.get('total_days', 21)
        total_eggs = int(data.get('total_eggs', 0) or 0)
        notes      = data.get('notes', '') or ''
        source     = data.get('source', '') or ''
        now        = int(time.time())
        with get_tb_db() as conn:
            # Tutup sesi sebelumnya jika ada yang masih open
            conn.execute(
                'UPDATE incubation_sessions SET ended_at=? WHERE ended_at IS NULL',
                (now,)
            )
            conn.execute(
                '''INSERT INTO incubation_sessions
                   (started_at, species, total_days, total_eggs, notes, source)
                   VALUES (?,?,?,?,?,?)''',
                (now, species, days, total_eggs, notes, source)
            )
            new_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
            conn.commit()
        # Beritahu ESP32
        publish_command('start_incubation', True)
        return jsonify({"ok": True, "id": new_id, "started_at": now, "species": species})

    @tb_bp.route('/api/incubation/current')
    def api_incubation_current():
        with get_tb_db() as conn:
            row = conn.execute(
                'SELECT * FROM incubation_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
            ).fetchone()
        if not row:
            return jsonify({"active": False})
        r    = dict(row)
        now  = int(time.time())
        elapsed_days = max(0, (now - r['started_at']) // 86400)
        r['elapsed_days'] = elapsed_days
        r['active']       = True
        return jsonify(r)

    # ─── API: konfigurasi MQTT (read-only, dari env var) ───
    @tb_bp.route('/api/config')
    def api_config():
        return jsonify({
            "mqtt_host": MQTT_HOST,
            "mqtt_port": MQTT_PORT,
            "device_id": MQTT_DEVICE_ID,
            "topics": {
                "sensor":  TOPIC_SENSOR,
                "status":  TOPIC_STATUS,
                "alarm":   TOPIC_ALARM,
                "command": TOPIC_CMD,
                "setting": TOPIC_SETTING,
            }
        })

    # ─── API: TTS edge-tts (id-ID-TutiNeural atau voice lain) ───
    @tb_bp.route('/api/tts', methods=['POST'])
    def api_tts():
        import sys, subprocess
        from flask import Response

        data  = request.get_json() or {}
        text  = (data.get('text') or '').strip()
        voice = data.get('voice', 'id-ID-GadisNeural')

        if not text:
            return jsonify({"error": "text kosong"}), 400

        # Preprocessing: konversi angka, simbol, singkatan ke ucapan natural
        if _TTS_UTILS_OK:
            text = preprocess_tts(text)
            logger.debug(f"[TerraBreed TTS] preprocessed: {text[:80]}")

        # Jalankan edge-tts di subprocess Python terpisah agar tidak terkena
        # monkey-patch eventlet (yang meng-patch socket di level OS sejak import).
        # Subprocess baru = proses bersih tanpa patch apapun.
        _script = (
            "import asyncio, sys, io\n"
            "try:\n"
            "    import edge_tts\n"
            "except ImportError:\n"
            "    sys.stderr.write('IMPORT_ERROR'); sys.exit(2)\n"
            "async def _gen():\n"
            "    c = edge_tts.Communicate(sys.argv[1], sys.argv[2])\n"
            "    buf = io.BytesIO()\n"
            "    async for chunk in c.stream():\n"
            "        if chunk['type'] == 'audio':\n"
            "            buf.write(chunk['data'])\n"
            "    return buf.getvalue()\n"
            "data = asyncio.run(_gen())\n"
            "if not data:\n"
            "    sys.stderr.write('EMPTY_AUDIO'); sys.exit(3)\n"
            "sys.stdout.buffer.write(data)\n"
        )

        try:
            result = subprocess.run(
                [sys.executable, "-c", _script, text, voice],
                capture_output=True,
                timeout=30
            )
        except subprocess.TimeoutExpired:
            logger.error("[TerraBreed TTS] subprocess timeout")
            return jsonify({"error": "TTS timeout"}), 500
        except Exception as e:
            logger.error(f"[TerraBreed TTS] subprocess error: {e}")
            return jsonify({"error": str(e)}), 500

        if result.returncode == 2:
            return jsonify({"error": "edge-tts belum terinstall. Jalankan: pip install edge-tts"}), 500
        if result.returncode == 3:
            return jsonify({"error": "TTS menghasilkan audio kosong — cek nama voice"}), 500
        if result.returncode != 0:
            err = result.stderr.decode(errors='replace').strip()
            logger.error(f"[TerraBreed TTS] error: {err}")
            return jsonify({"error": err or "TTS gagal"}), 500

        audio_bytes = result.stdout
        if not audio_bytes:
            return jsonify({"error": "TTS menghasilkan audio kosong"}), 500

        return Response(
            audio_bytes,
            mimetype='audio/mpeg',
            headers={"Cache-Control": "no-cache", "Content-Length": str(len(audio_bytes))}
        )

    # ─── API: STT — MediaRecorder audio → Groq Whisper ───────────────
    @tb_bp.route('/api/stt', methods=['POST'])
    def api_stt():
        """
        Transkripsi audio dari browser (webm/ogg/wav) menggunakan Groq Whisper.
        Dipanggil oleh floating mic widget di terrabreed.html.
        """
        if 'audio' not in request.files:
            return jsonify({"error": "Tidak ada file audio"}), 400

        audio_file = request.files['audio']
        lang       = request.form.get('lang', 'id')

        import tempfile, os as _os
        suffix = '.webm'
        fname  = audio_file.filename or ''
        for ext in ('.wav', '.mp3', '.ogg', '.m4a'):
            if fname.endswith(ext):
                suffix = ext
                break

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                audio_file.save(tmp.name)
                tmp_path = tmp.name

            with open(tmp_path, 'rb') as f:
                kwargs = dict(
                    file=(_os.path.basename(tmp_path), f),
                    model="whisper-large-v3-turbo",
                    response_format="text"
                )
                if lang and lang.lower() not in ('auto', ''):
                    kwargs['language'] = lang
                transcription = groq_client.audio.transcriptions.create(**kwargs)

            _os.unlink(tmp_path)
            text = transcription if isinstance(transcription, str) else transcription.text
            logger.info(f"[TerraBreed STT] {text[:80]}")
            return jsonify({"text": text.strip()})

        except Exception as e:
            logger.error(f"[TerraBreed STT] error: {e}")
            try:
                if tmp_path:
                    _os.unlink(tmp_path)
            except:
                pass
            return jsonify({"error": str(e)}), 500

    # ─── API: simpan pengaturan inkubasi (kirim ke ESP32 via MQTT) ───
    @tb_bp.route('/api/settings', methods=['POST'])
    def api_settings():
        data = request.get_json() or {}
        results = {}
        key_map = {
            'target_temp'   : 'target_temp',
            'target_humid'  : 'target_humid',
            'turn_interval' : 'interval',
            'turn_duration' : 'duration',
            'stop_day'      : 'stop_day',
            # PID
            'pid_kp'        : 'pid_kp',
            'pid_ki'        : 'pid_ki',
            'pid_kd'        : 'pid_kd',
        }
        for form_key, mqtt_key in key_map.items():
            if form_key in data:
                try:
                    val = float(data[form_key])
                    ok  = publish_setting(mqtt_key, val)
                    results[form_key] = ok
                except (ValueError, TypeError):
                    results[form_key] = False
        return jsonify({"ok": True, "results": results})

    # ─── API: tutup sesi inkubasi ───
    @tb_bp.route('/api/incubation/finish', methods=['POST'])
    def api_incubation_finish():
        data       = request.get_json() or {}
        session_id = data.get('id')
        hatched    = int(data.get('hatched',   0) or 0)
        infertile  = int(data.get('infertile', 0) or 0)
        notes      = data.get('notes', '') or ''
        now        = int(time.time())
        with get_tb_db() as conn:
            # Jika id tidak dikirim, tutup sesi aktif terakhir
            if not session_id:
                row = conn.execute(
                    'SELECT id FROM incubation_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
                ).fetchone()
                if not row:
                    return jsonify({"ok": False, "error": "Tidak ada sesi inkubasi aktif"}), 404
                session_id = row['id']
            cur = conn.execute(
                '''UPDATE incubation_sessions
                   SET ended_at=?, notes=?, hatched=?, infertile=?
                   WHERE id=? AND ended_at IS NULL''',
                (now, notes, hatched, infertile, session_id)
            )
            conn.commit()
            if cur.rowcount == 0:
                return jsonify({"ok": False, "error": f"Sesi id={session_id} tidak ditemukan atau sudah ditutup"}), 404
        # stop_incubation tidak perlu dikirim ke ESP32 (inkubasi lanjut berjalan)
        return jsonify({"ok": True, "ended_at": now, "id": session_id})


    # ─── API: daftar semua sesi inkubasi ───
    @tb_bp.route('/api/incubation/sessions')
    def api_incubation_sessions():
        limit = int(request.args.get('limit', 50))
        with get_tb_db() as conn:
            rows = conn.execute(
                'SELECT * FROM incubation_sessions ORDER BY started_at DESC LIMIT ?',
                (limit,)
            ).fetchall()
        now  = int(time.time())
        out  = []
        for r in rows:
            d = dict(r)
            if d['ended_at'] is None:
                d['elapsed_days'] = max(0, (now - d['started_at']) // 86400)
                d['active'] = True
            else:
                d['elapsed_days'] = max(0, (d['ended_at'] - d['started_at']) // 86400)
                d['active'] = False
            out.append(d)
        return jsonify(out)

    # ─── Socket.IO: kirim konfigurasi MQTT ke client ───
    @socketio.on('tb_get_config', namespace='/terrabreed')
    def handle_get_config():
        from flask_socketio import emit as sio_emit
        sio_emit('tb_config', {
            "mqtt_host": MQTT_HOST,
            "mqtt_port": MQTT_PORT,
            "device_id": MQTT_DEVICE_ID,
        })

    # ─── Socket.IO: terima command dari dashboard, forward ke ESP32 ───
    @socketio.on('tb_command', namespace='/terrabreed')
    def handle_tb_command(data):
        from flask_socketio import emit as sio_emit
        cmd = data.get('command', '')
        val = data.get('value')
        if not cmd:
            sio_emit('command_result', {"ok": False, "error": "command kosong"})
            return
        setting_keys = {'target_temp', 'target_humid', 'interval', 'duration', 'turn_interval_min', 'turn_duration_sec'}
        if cmd in setting_keys:
            ok = publish_setting(cmd, val)
        else:
            ok = publish_command(cmd, val)
        sio_emit('command_result', {"command": cmd, "value": val, "ok": ok})

    # ─── Socket.IO: chat AI via socket (realtime tanpa page reload) ───
    @socketio.on('tb_chat', namespace='/terrabreed')
    def handle_tb_chat(data):
        from flask_socketio import emit as sio_emit
        message     = (data.get('message') or '').strip()
        session_ctx = (data.get('session_ctx') or '').strip()
        if not message:
            sio_emit('tb_chat_reply', {"reply": "Pesan kosong.", "commands_executed": []})
            return
        result = tb_ai_chat(groq_client, message, session_ctx)
        sio_emit('tb_chat_reply', result)

    # ─── Socket.IO: diagnosa kode sumber — AI membaca .py + .html + .ino ───
    @socketio.on('tb_diagnose', namespace='/terrabreed')
    def handle_tb_diagnose(data):
        from flask_socketio import emit as sio_emit
        # Segera beritahu client bahwa proses dimulai
        sio_emit('tb_diagnose_progress', {
            "message": (
                "⏳ Membaca ketiga file sumber kode... "
                "AI sedang menganalisis terrabreed.py, terrabreed.html, dan incubator_main.ino. "
                "Mohon tunggu 20–60 detik."
            )
        })
        result = tb_ai_diagnose(groq_client)   # blocking — tapi Socket.IO menjalankan ini di thread/greenlet terpisah
        sio_emit('tb_diagnose_reply', result)



    # ─── Register TTS admin blueprint (/tts-settings) ───
    if _TTS_UTILS_OK:
        try:
            from tts_admin import tts_bp as _tts_admin_bp
            @tb_bp.record_once
            def _register_tts_admin(state):
                try:
                    state.app.register_blueprint(_tts_admin_bp)
                    logger.info("[TerraBreed] TTS admin UI tersedia di /tts-settings")
                except Exception as _e:
                    logger.warning(f"[TerraBreed] Gagal register tts_admin: {_e}")
        except ImportError:
            logger.info("[TerraBreed] tts_admin.py tidak ditemukan, halaman /tts-settings dinonaktifkan")
    return tb_bp, socketio



# ══════════════════════════════════════════════════════════
#  MQTT + SOCKETIO INIT (dipanggil setelah app.run siap)
# ══════════════════════════════════════════════════════════

def init_terrabreed_mqtt(app, socketio_instance):
    """
    Inisialisasi MQTT subscriber dan SocketIO.
    Dipanggil SETELAH blueprint di-register ke app.
    """
    import paho.mqtt.client as mqtt

    global _mqtt_client

    # Init SocketIO dengan app
    socketio_instance.init_app(app, cors_allowed_origins="*", async_mode='threading', allow_unsafe_werkzeug=True)

    def on_connect(client, userdata, flags, rc):
        if rc == 0:
            logger.info(f"[TerraBreed MQTT] Connected ke {MQTT_HOST}:{MQTT_PORT}")
            client.subscribe(TOPIC_SENSOR)
            client.subscribe(TOPIC_STATUS)
            client.subscribe(TOPIC_ALARM)
            logger.info(f"[TerraBreed MQTT] Subscribe: {TOPIC_SENSOR}, {TOPIC_STATUS}, {TOPIC_ALARM}")
        else:
            logger.error(f"[TerraBreed MQTT] Connect failed rc={rc}")

    def on_disconnect(client, userdata, rc):
        logger.warning(f"[TerraBreed MQTT] Disconnected rc={rc}, reconnecting...")

    def on_message(client, userdata, msg):
        topic   = msg.topic
        payload = msg.payload.decode('utf-8', errors='replace')

        try:
            data = json.loads(payload)
        except Exception:
            logger.warning(f"[TerraBreed MQTT] Invalid JSON dari {topic}: {payload[:80]}")
            return

        now = int(time.time())

        if topic == TOPIC_SENSOR:
            with _state_lock:
                _latest_sensor.update(data)

            # Simpan ke DB setiap 60 detik (tidak setiap pesan)
            _maybe_log_sensor(data, now)

            # Normalise tray_tilted (bool dari .ino) → tray_position (string untuk HTML)
            # publishSensorData() ESP32 mengirim tray_tilted:true/false, bukan tray_position
            if 'tray_tilted' in data and 'tray_position' not in data:
                data['tray_position'] = 'Kiri (-45°)' if data['tray_tilted'] else 'Kanan (+45°)'

            # Push ke browser via SocketIO
            with app.app_context():
                socketio_instance.emit('sensor_update', data, namespace='/terrabreed')

        elif topic == TOPIC_STATUS:
            with _state_lock:
                _latest_status.update(data)

            with app.app_context():
                socketio_instance.emit('status_update', data, namespace='/terrabreed')

        elif topic == TOPIC_ALARM:
            # ESP32 mengirim key "alarm" (lihat publishAlarm() di .ino), bukan "type"
            alarm_type = data.get('alarm', data.get('type', 'UNKNOWN'))
            alarm_val  = data.get('value')

            # Format pesan human-readable berdasarkan type
            _alarm_map = {
                # Alarm types yang dikirim ESP32 (sendAlarm() di .ino)
                'SUHU_TERLALU_TINGGI':       'Suhu terlalu tinggi',
                'SUHU_TERLALU_RENDAH':       'Suhu terlalu rendah',
                'KELEMBAPAN_TERLALU_TINGGI': 'Kelembapan terlalu tinggi',
                'KELEMBAPAN_TERLALU_RENDAH': 'Kelembapan terlalu rendah',
                'SELISIH_SENSOR_DS18B20':    'Selisih suhu DS18B20 #1 vs #2 melebihi batas',
                # Alias lama (untuk kompatibilitas backward jika pernah digunakan)
                'TEMP_HIGH':    'Suhu terlalu tinggi',
                'TEMP_LOW':     'Suhu terlalu rendah',
                'TEMP_NORMAL':  'Suhu kembali normal',
                'HUMID_HIGH':   'Kelembapan terlalu tinggi',
                'HUMID_LOW':    'Kelembapan terlalu rendah',
                'HUMID_NORMAL': 'Kelembapan kembali normal',
                'SENSOR_ERROR': 'Error baca sensor',
                'MOTOR_OK':     'Motor rak berhasil diputar',
                'HEATER_ON':    'Pemanas dinyalakan',
                'HEATER_OFF':   'Pemanas dimatikan',
                'FAN_ON':       'Kipas dinyalakan',
                'FAN_OFF':      'Kipas dimatikan',
                'REBOOT':       'ESP32 reboot',
            }
            # Buat pesan yang readable
            base_msg = _alarm_map.get(alarm_type, data.get('message', alarm_type))
            extra = []
            if data.get('temp')  is not None: extra.append(f"suhu {float(data['temp']):.1f}°C")
            if data.get('humid') is not None: extra.append(f"lembap {float(data['humid']):.1f}%")
            alarm_msg = base_msg + (' — ' + ', '.join(extra) if extra else '')

            with get_tb_db() as conn:
                conn.execute(
                    'INSERT INTO alarm_logs (ts, type, message, value) VALUES (?,?,?,?)',
                    (now, alarm_type, alarm_msg, alarm_val)
                )
                conn.commit()

            logger.warning(f"[TerraBreed ALARM] {alarm_type}: {alarm_msg}")

            # Kirim ke browser dengan message yang sudah formatted
            data['message'] = alarm_msg
            with app.app_context():
                socketio_instance.emit('alarm', data, namespace='/terrabreed')

    # Throttle logging sensor — simpan max 1x per 60 detik
    _last_log_ts = [0]

    def _maybe_log_sensor(data: dict, now: int):
        if now - _last_log_ts[0] < 60:
            return
        _last_log_ts[0] = now
        try:
            with get_tb_db() as conn:
                conn.execute('''
                    INSERT INTO sensor_logs (
                        ts, temp, temp_ds1, temp_ds2, temp_sht, humidity,
                        target_temp, target_humid, heater, humidifier, fan,
                        auto_mode, tray_pos, motor_state
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ''', (
                    now,
                    data.get('temp'),
                    data.get('temp_ds1'),
                    data.get('temp_ds2'),
                    data.get('temp_sht'),
                    data.get('humidity'),
                    data.get('target_temp'),
                    data.get('target_humid'),
                    1 if data.get('heater') else 0,
                    1 if data.get('humidifier') else 0,
                    1 if data.get('fan') else 0,
                    1 if data.get('auto_mode') else 0,
                    ('Kiri (-45°)' if data.get('tray_tilted') else 'Kanan (+45°)') if data.get('tray_tilted') is not None else data.get('tray_position', ''),
                    data.get('motor_state', ''),
                ))
                conn.commit()
        except Exception as e:
            logger.error(f"[TerraBreed] DB log error: {e}")

    # Buat dan jalankan MQTT client
    _mqtt_client = mqtt.Client(client_id=f"terrabreed_server_{int(time.time())}")
    _mqtt_client.on_connect    = on_connect
    _mqtt_client.on_disconnect = on_disconnect
    _mqtt_client.on_message    = on_message

    def _mqtt_thread():
        while True:
            try:
                _mqtt_client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
                _mqtt_client.loop_forever()
            except Exception as e:
                logger.error(f"[TerraBreed MQTT] Error: {e}, retry 10s...")
                time.sleep(10)

    t = threading.Thread(target=_mqtt_thread, daemon=True, name='terrabreed-mqtt')
    t.start()
    logger.info(f"[TerraBreed] MQTT thread started → {MQTT_HOST}:{MQTT_PORT}")
