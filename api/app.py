import json
import os
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
FRONTEND_URL = os.environ.get("FRONTEND_URL")
# CORS(app, origins= FRONTEND_URL)
CORS(app)

DATA_FILE = os.path.join(os.path.dirname(__file__), "data.json")
MASTER_PASSWORD = os.environ.get("MASTER_PASSWORD")


def read_data():
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def write_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


@app.route("/api/data", methods=["GET"])
def get_data():
    return jsonify(read_data())


@app.route("/api/data", methods=["POST"])
def save_data():
    client_password = request.headers.get("X-Admin-Password")

    if not MASTER_PASSWORD or client_password != MASTER_PASSWORD:
        return jsonify({"error": "Unauthorized: Invalid or missing password"}), 401
    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify({"error": "Body must be valid JSON"}), 400
    write_data(payload)
    return jsonify({"status": "ok"})


@app.route("/api/login", methods=["POST"])
def login():
    payload = request.get_json(silent=True) or {}
    password = payload.get("password", "")
    if password == MASTER_PASSWORD:
        return jsonify({"status": "ok"}), 200
    return jsonify({"error": "Incorrect password"}), 401


if __name__ == "__main__":
    app.run(port=5000)