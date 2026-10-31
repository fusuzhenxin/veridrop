"""Run due probes without overlapping batches."""

from __future__ import annotations

import threading

import ops_db
import ops_probe

JOB = threading.Lock()


def _guarded(fn):
    if not JOB.acquire(blocking=False):
        raise RuntimeError("已有任务在跑")
    try:
        return fn()
    finally:
        JOB.release()


def _probe_one(station_id: int) -> None:
    try:
        context = ops_db.station_probe_context(station_id)
        runs = ops_probe.probe_station(context)
    except Exception as err:
        runs = [{"kind": "ping", "ok": False, "latency_ms": 0, "model": "", "cost": 0, "error_type": "connect", "detail": str(err)[:300]}]
    ops_db.finish_probe(station_id, runs)


def _check_one(site_id: int) -> None:
    try:
        site = ops_db.site_context(site_id)
        result = ops_probe.check_site(site)
    except Exception as err:
        result = {"ok": False, "latency_ms": 0, "error_type": "connect", "detail": str(err)[:300]}
    ops_db.finish_site(site_id, result)


def run_station(station_id: int) -> dict:
    def work():
        _probe_one(station_id)
        return ops_db.get_station(station_id)

    return _guarded(work)


def run_site(site_id: int) -> dict:
    def work():
        _check_one(site_id)
        return ops_db.get_site(site_id)

    return _guarded(work)


def _due_body() -> dict:
    settings = ops_db.get_settings()
    limit = max(1, int(float(settings.get("batch_limit") or 20)))
    stations = ops_db.due_stations(limit)
    sites = ops_db.due_sites()
    batch_id = ops_db.start_batch("due", len(stations) + len(sites))
    done = 0
    try:
        for station in stations:
            _probe_one(station["id"])
            done += 1
            ops_db.advance_batch(batch_id, done)
        for site in sites:
            _check_one(site["id"])
            done += 1
            ops_db.advance_batch(batch_id, done)
        ops_db.finish_batch(batch_id, "done", f"完成 {done} 项")
    except Exception as err:
        ops_db.finish_batch(batch_id, "failed", str(err)[:300])
        raise
    return {"batch": batch_id, "total": len(stations) + len(sites)}


def run_due() -> dict:
    return _guarded(_due_body)


def start_due() -> dict:
    if not JOB.acquire(blocking=False):
        raise RuntimeError("已有任务在跑")

    def wrap():
        try:
            _due_body()
        except Exception:
            pass
        finally:
            JOB.release()

    threading.Thread(target=wrap, daemon=True).start()
    return {"started": True}


def start_sites() -> dict:
    if not JOB.acquire(blocking=False):
        raise RuntimeError("已有任务在跑")

    def wrap():
        try:
            page = ops_db.list_sites({"page": 1, "size": 100})
            sites = page["items"]
            batch_id = ops_db.start_batch("sites", len(sites))
            try:
                for index, site in enumerate(sites, start=1):
                    _check_one(site["id"])
                    ops_db.advance_batch(batch_id, index)
                ops_db.finish_batch(batch_id, "done", f"检查 {len(sites)} 个站点")
            except Exception as err:
                ops_db.finish_batch(batch_id, "failed", str(err)[:300])
        finally:
            JOB.release()

    threading.Thread(target=wrap, daemon=True).start()
    return {"started": True}


def maybe_schedule() -> bool:
    hour = __import__("datetime").datetime.now(ops_db.TZ).hour
    if not ops_db.scheduler_due(hour):
        return False
    if not ops_db.mark_scheduled(ops_db.today()):
        return False
    try:
        run_due()
    except RuntimeError:
        return False
    return True
