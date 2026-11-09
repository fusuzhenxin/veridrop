"""Exercise the real public sharing API with disposable records and no model requests."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
import community
import shared_reports


def fixture(suite):
    return {"id": suite + "-fixture123", "suite": suite, "running": False,
            "host": "分享测试.example", "base": "https://user:password@relay.example.test/v1?key=private",
            "model": "测试样例模型", "started": 1794090000000, "finishedAt": 1794090076000,
            "result": "通过", "key": "do-not-save", "apiKey": "do-not-save", "keyMask": "sensitive",
            "rows": [{"id": "pelican" if suite == "pelican" else "candy", "label": "样例检测",
                      "status": "pass", "summary": "Bearer very-private-secret", "raw": "do-not-save"}],
            "candyRows": [{"prompt": "测试题目", "picked": "A", "ok": True, "dimension": "数量关系",
                           "options": [{"key": "A", "text": "测试答案"}], "answer": "A"}],
            "pelicanHtml": "<!doctype html><html><body><svg><text>测试画面</text></svg></body></html>"}


with tempfile.TemporaryDirectory() as tmp:
    shared_reports.DIR = Path(tmp)
    server = community.ThreadingHTTPServer(("127.0.0.1", 0), community.Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    origin = "http://127.0.0.1:" + str(server.server_port)

    def request(path, payload=None, header=True, declared_size=None):
        headers = {"Content-Type": "application/json"}
        if header:
            headers["X-Veridrop-Share"] = "1"
        if declared_size:
            headers["Content-Length"] = str(declared_size)
        req = Request(origin + path, data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
        try:
            with urlopen(req) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    try:
        for suite in ("candy", "pelican", "all"):
            source = fixture(suite)
            status, created = request("/api/shared-reports", source)
            assert status == 201, created
            token = created["token"]
            status, received = request("/api/shared-reports/" + token)
            assert status == 200 and received["id"] == source["id"]
            assert received["candyRows"][0]["prompt"] == "测试题目"
            assert "测试画面" in received["pelicanHtml"] if suite != "candy" else not received["pelicanHtml"]
            assert received["host"] == "relay.example.test"
            assert received["base"] == "https://relay.example.test"
            assert received["keyMask"] == "—"
            assert not received["rows"][0]["raw"]
            assert "do-not-save" not in json.dumps(received)
            assert "very-private-secret" not in json.dumps(received)
            assert request("/api/shared-reports", source)[1]["token"] == token
            assert shared_reports.read(token) == received, "Result survives independent disk read"
            before = copy.deepcopy(received)
            source["model"] = "第二个模型"
            changed = request("/api/shared-reports", source)[1]
            assert changed["token"] != token and shared_reports.read(token) == before
        assert request("/api/shared-reports", fixture("candy"), False)[0] == 403
        assert request("/api/shared-reports", {**fixture("candy"), "running": True})[0] == 400
        assert request("/api/shared-reports/not-a-token")[0] == 404
        assert request("/api/shared-reports", {}, declared_size=2_000_001)[0] == 413
        shared_reports.RATE["127.0.0.1"] = (shared_reports.time.time(), 20)
        assert request("/api/shared-reports", fixture("candy"))[0] == 400
        print("PASS: candy/pelican/all public links, immutable disk storage, deduplication, credentials removed, size/rate limits, invalid and unfinished results.")
    finally:
        server.shutdown()
        server.server_close()
