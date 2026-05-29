"""
TerraBreed Flask Server
========================
Jalankan: python server.py
Atau dengan env var:
  TB_MQTT_HOST=192.168.1.x python server.py

Dependencies:
  pip install flask flask-socketio paho-mqtt groq edge-tts openai-whisper
"""

import os
import json
import logging
import time
import sqlite3
import threading
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO
from flask_cors import CORS

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
logger = logging.getLogger(__name__)

# ─── Init Flask ───
app = Flask(__name__, static_folder='server/templates')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'terrabreed-secret-2025')
CORS(app, resources={r"/api/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# ─── Import modul TerraBreed ───
try:
    from terrabreed import (
        create_terrabreed_blueprint,
        init_terrabreed_mqtt,
        _latest_sensor,
        _latest_status,
        _state_lock,
        get_tb_db,
        init_tb_db,
        publish_command,
    )
    HAS_TERRABREED = True
    logger.info("✅ Modul terrabreed berhasil diimpor")
except ImportError as e:
    HAS_TERRABREED = False
    logger.warning(f"⚠️  Modul terrabreed tidak ditemukan: {e}. Berjalan dalam mode demo.")

# ─── MQTT client (paho) ───
_mqtt_client = None

def setup_mqtt():
    global _mqtt_client
    try:
        import paho.mqtt.client as mqtt
        host = os.environ.get('TB_MQTT_HOST', '10.10.10.1')
        port = int(os.environ.get('TB_MQTT_PORT', 1883))
        device_id = os.environ.get('TB_DEVICE_ID', 'incubator_01')

        client = mqtt.Client(client_id='terrabreed-server', clean_session=True)

        def on_connect(c, userdata, flags, rc):
            if rc == 0:
                logger.info(f"✅ MQTT terhubung ke {host}:{port}")
                c.subscribe(f"{device_id}/sensor")
                c.subscribe(f"{device_id}/status")
                c.subscribe(f"{device_id}/alarm")
            else:
                logger.warning(f"MQTT gagal connect, rc={rc}")

        def on_message(c, userdata, msg):
            try:
                payload = json.loads(msg.payload.decode())
                topic = msg.topic
                if HAS_TERRABREED:
                    with _state_lock:
                        if topic.endswith('/sensor'):
                            _latest_sensor.update(payload)
                        elif topic.endswith('/status'):
                            _latest_status.update(payload)
                socketio.emit('sensor_update', payload)
                logger.debug(f"MQTT {topic}: {payload}")
            except Exception as e:
                logger.error(f"MQTT on_message error: {e}")

        client.on_connect = on_connect
        client.on_message = on_message
        client.connect_async(host, port, keepalive=60)
        client.loop_start()
        _mqtt_client = client
        if HAS_TERRABREED:
            import terrabreed as tb
            tb._mqtt_client = client
        logger.info(f"MQTT client dimulai → {host}:{port}")
    except ImportError:
        logger.warning("⚠️  paho-mqtt tidak terinstall. Widget tidak akan menerima data real-time.")
    except Exception as e:
        logger.error(f"Setup MQTT gagal: {e}")


# ─── Database helper lokal (jika terrabreed.py tidak tersedia) ───
DB_PATH = os.path.join(os.path.dirname(__file__), 'terrabreed.db')

def get_db():
    if HAS_TERRABREED:
        return get_tb_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    if HAS_TERRABREED:
        init_tb_db()
        return
    with get_db() as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS sensor_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            temp REAL, humidity REAL,
            target_temp REAL, target_humid REAL,
            heater INTEGER, humidifier INTEGER, fan INTEGER, auto_mode INTEGER
        )''')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_sensor_ts ON sensor_logs(ts DESC)')
        conn.execute('''CREATE TABLE IF NOT EXISTS incubation_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            species TEXT DEFAULT "ayam",
            total_days INTEGER DEFAULT 21,
            total_eggs INTEGER DEFAULT 0,
            hatched INTEGER DEFAULT 0,
            infertile INTEGER DEFAULT 0,
            notes TEXT
        )''')
        conn.commit()
    logger.info("✅ DB lokal diinisialisasi: " + DB_PATH)


# ══════════════════════════════════════
#  API ENDPOINTS
# ══════════════════════════════════════

@app.route('/')
def index():
    """Landing page / status server."""
    return jsonify({
        "app": "TerraBreed Server",
        "version": "2.0",
        "status": "running",
        "mqtt": _mqtt_client is not None,
        "time": datetime.now().isoformat(),
    })


@app.route('/api/sensor/latest')
def sensor_latest():
    """Data sensor terakhir dari cache MQTT."""
    if HAS_TERRABREED:
        with _state_lock:
            sensor = dict(_latest_sensor)
            status = dict(_latest_status)
    else:
        sensor = {}
        status = {}

    # Fallback: ambil dari DB jika cache kosong
    if not sensor:
        try:
            with get_db() as conn:
                row = conn.execute(
                    'SELECT * FROM sensor_logs ORDER BY ts DESC LIMIT 1'
                ).fetchone()
                if row:
                    sensor = dict(row)
        except Exception:
            pass

    return jsonify({"sensor": sensor, "status": status, "ts": int(time.time())})


@app.route('/api/sensor/history')
def sensor_history():
    """Riwayat sensor dalam N menit terakhir."""
    minutes = int(request.args.get('minutes', 60))
    since_ts = int(time.time()) - minutes * 60
    try:
        with get_db() as conn:
            rows = conn.execute(
                'SELECT * FROM sensor_logs WHERE ts >= ? ORDER BY ts ASC',
                (since_ts,)
            ).fetchall()
        return jsonify({"history": [dict(r) for r in rows], "minutes": minutes})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/sensor/stats')
def sensor_stats():
    """Statistik suhu & kelembapan 24 jam terakhir."""
    since_ts = int(time.time()) - 86400
    try:
        with get_db() as conn:
            row = conn.execute('''
                SELECT
                  AVG(temp) as avg_temp, MIN(temp) as min_temp, MAX(temp) as max_temp,
                  AVG(humidity) as avg_humid, MIN(humidity) as min_humid, MAX(humidity) as max_humid,
                  COUNT(*) as count
                FROM sensor_logs WHERE ts >= ?
            ''', (since_ts,)).fetchone()
        return jsonify(dict(row) if row else {})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/command', methods=['POST'])
def send_command():
    """Kirim perintah ke ESP32 via MQTT."""
    data = request.get_json(force=True) or {}
    cmd = data.get('command') or data.get('cmd')
    value = data.get('value')
    if not cmd:
        return jsonify({"error": "field 'command' wajib diisi"}), 400

    if _mqtt_client:
        ok = publish_command(cmd, value) if HAS_TERRABREED else False
        if not ok and _mqtt_client:
            payload = json.dumps({"cmd": cmd, "value": value})
            _mqtt_client.publish(
                f"{os.environ.get('TB_DEVICE_ID', 'incubator_01')}/command",
                payload, qos=1
            )
        return jsonify({"ok": True, "cmd": cmd, "value": value})
    else:
        return jsonify({"ok": False, "error": "MQTT tidak terhubung"}), 503


@app.route('/api/incubation/current')
def incubation_current():
    """Sesi inkubasi aktif."""
    try:
        with get_db() as conn:
            row = conn.execute('''
                SELECT * FROM incubation_sessions
                WHERE ended_at IS NULL
                ORDER BY started_at DESC LIMIT 1
            ''').fetchone()
        if not row:
            return jsonify({"session": None})
        d = dict(row)
        elapsed_day = int((time.time() - d['started_at']) // 86400)
        d['day_number'] = elapsed_day
        d['days_remaining'] = max(0, d['total_days'] - elapsed_day)
        return jsonify({"session": d})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/incubation/start', methods=['POST'])
def incubation_start():
    """Mulai sesi inkubasi baru."""
    data = request.get_json(force=True) or {}
    species = data.get('species', 'ayam')
    total_eggs = int(data.get('total_eggs', 0))
    total_days = int(data.get('total_days', 21))
    notes = data.get('notes', '')
    ts = int(time.time())
    try:
        with get_db() as conn:
            conn.execute(
                'UPDATE incubation_sessions SET ended_at=? WHERE ended_at IS NULL',
                (ts,)
            )
            cur = conn.execute(
                '''INSERT INTO incubation_sessions
                   (started_at, species, total_days, total_eggs, notes)
                   VALUES (?, ?, ?, ?, ?)''',
                (ts, species, total_days, total_eggs, notes)
            )
            conn.commit()
            new_id = cur.lastrowid
        return jsonify({"ok": True, "id": new_id, "species": species})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/incubation/finish', methods=['POST'])
def incubation_finish():
    """Tutup sesi inkubasi aktif."""
    data = request.get_json(force=True) or {}
    hatched = int(data.get('hatched', 0))
    infertile = int(data.get('infertile', 0))
    notes = data.get('notes', '')
    ts = int(time.time())
    try:
        with get_db() as conn:
            conn.execute(
                '''UPDATE incubation_sessions
                   SET ended_at=?, hatched=?, infertile=?, notes=?
                   WHERE ended_at IS NULL''',
                (ts, hatched, infertile, notes)
            )
            conn.commit()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/alarms')
def get_alarms():
    """Daftar alarm terakhir."""
    limit = int(request.args.get('limit', 20))
    try:
        with get_db() as conn:
            rows = conn.execute(
                'SELECT * FROM alarm_logs ORDER BY ts DESC LIMIT ?', (limit,)
            ).fetchall()
        return jsonify({"alarms": [dict(r) for r in rows]})
    except Exception:
        return jsonify({"alarms": []})


@app.route('/api/config', methods=['GET', 'POST'])
def config():
    """Baca / simpan konfigurasi (key-value di DB)."""
    if request.method == 'POST':
        data = request.get_json(force=True) or {}
        return jsonify({"ok": True, "saved": data})
    return jsonify({
        "mqtt_host": os.environ.get('TB_MQTT_HOST', '10.10.10.1'),
        "mqtt_port": int(os.environ.get('TB_MQTT_PORT', 1883)),
        "device_id": os.environ.get('TB_DEVICE_ID', 'incubator_01'),
    })


# ─── SocketIO events ───
@socketio.on('connect')
def on_connect():
    logger.info(f"SocketIO client terhubung: {request.sid}")

@socketio.on('disconnect')
def on_disconnect():
    logger.info(f"SocketIO client terputus: {request.sid}")


# ══════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5050))
    host = os.environ.get('HOST', '0.0.0.0')
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'

    logger.info(f"🚀 TerraBreed Server v2.0 — http://{host}:{port}")
    init_db()
    setup_mqtt()

    # Jika ada Groq API key, register TerraBreed AI blueprint
    if HAS_TERRABREED and os.environ.get('GROQ_API_KEY'):
        try:
            import groq
            groq_client = groq.Groq(api_key=os.environ['GROQ_API_KEY'])
            tb_bp, tb_socketio = create_terrabreed_blueprint(groq_client)
            app.register_blueprint(tb_bp, url_prefix='/api')
            logger.info("✅ TerraBreed AI blueprint terdaftar di /api")
        except Exception as e:
            logger.warning(f"TerraBreed blueprint gagal: {e}")

    socketio.run(app, host=host, port=port, debug=debug, allow_unsafe_werkzeug=True)
