# tts_admin.py
# Flask Blueprint untuk halaman manajemen TTS
# Daftarkan ke app.py dengan:
#   from tts_admin import tts_bp
#   app.register_blueprint(tts_bp)
#
# Akses via: http://your-server/tts-settings

import asyncio
import os
import tempfile
from pathlib import Path
from flask import Blueprint, send_file, request, jsonify

import tts_utils as tu

# template_folder menunjuk ke folder yang sama dengan tts_admin.py
_HERE = Path(__file__).parent
tts_bp = Blueprint("tts", __name__, url_prefix="/tts-settings",
                   template_folder=str(_HERE))


# ── Halaman utama ─────────────────────────────────────────────────────────────

@tts_bp.route("/")
def index():
    return send_file(_HERE / "tts_settings.html")


# ── API: Rules ────────────────────────────────────────────────────────────────

@tts_bp.route("/api/rules", methods=["GET"])
def api_rules_list():
    return jsonify(tu.get_all_rules())


@tts_bp.route("/api/rules", methods=["POST"])
def api_rules_upsert():
    data = request.json
    rid = tu.upsert_rule(data)
    return jsonify({"ok": True, "id": rid})


@tts_bp.route("/api/rules/<int:rid>", methods=["DELETE"])
def api_rules_delete(rid):
    tu.delete_rule(rid)
    return jsonify({"ok": True})


@tts_bp.route("/api/rules/<int:rid>/toggle", methods=["POST"])
def api_rules_toggle(rid):
    active = request.json.get("active", True)
    tu.toggle_rule(rid, active)
    return jsonify({"ok": True})


@tts_bp.route("/api/rules/reorder", methods=["POST"])
def api_rules_reorder():
    ids = request.json.get("ids", [])
    tu.reorder_rules(ids)
    return jsonify({"ok": True})


# ── API: Kamus ────────────────────────────────────────────────────────────────

@tts_bp.route("/api/kamus", methods=["GET"])
def api_kamus_list():
    return jsonify(tu.get_all_kamus())


@tts_bp.route("/api/kamus", methods=["POST"])
def api_kamus_upsert():
    data = request.json
    rid = tu.upsert_kamus(data)
    return jsonify({"ok": True, "id": rid})


@tts_bp.route("/api/kamus/<int:kid>", methods=["DELETE"])
def api_kamus_delete(kid):
    tu.delete_kamus(kid)
    return jsonify({"ok": True})


# ── API: SSML ─────────────────────────────────────────────────────────────────

@tts_bp.route("/api/ssml", methods=["GET"])
def api_ssml_list():
    return jsonify(tu.get_all_ssml())


@tts_bp.route("/api/ssml", methods=["POST"])
def api_ssml_upsert():
    data = request.json
    rid = tu.upsert_ssml(data)
    return jsonify({"ok": True, "id": rid})


@tts_bp.route("/api/ssml/<int:sid>", methods=["DELETE"])
def api_ssml_delete(sid):
    tu.delete_ssml(sid)
    return jsonify({"ok": True})


# ── API: Preview TTS ──────────────────────────────────────────────────────────

@tts_bp.route("/api/preview", methods=["POST"])
def api_preview():
    """
    Terima teks, proses, kembalikan:
    - teks_asli
    - teks_processed
    - audio base64 (mp3)
    """
    import base64

    body        = request.json or {}
    text        = body.get("text", "").strip()
    voice       = body.get("voice", "id-ID-TutiNeural")
    rate        = body.get("rate", "-10%")
    pitch       = body.get("pitch", "-3Hz")
    raw_mode    = body.get("raw_mode", False)   # True = skip preprocessing

    if not text:
        return jsonify({"ok": False, "error": "Teks kosong"}), 400

    processed = text if raw_mode else tu.preprocess_tts(text)

    # Generate audio ke tempfile
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            tmp_path = f.name

        loop = asyncio.new_event_loop()
        loop.run_until_complete(
            tu.speak(processed, tmp_path, voice=voice, rate=rate, pitch=pitch, skip_preprocess=True)
        )
        loop.close()

        with open(tmp_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode()

        os.unlink(tmp_path)

        return jsonify({
            "ok":           True,
            "teks_asli":    text,
            "teks_proses":  processed,
            "audio_b64":    audio_b64,
        })

    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
