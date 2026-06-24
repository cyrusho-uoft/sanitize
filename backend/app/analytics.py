"""Analytics aggregation — anonymous category counts only."""

import json
import os
import sqlite3
import csv
import io
import tempfile
from datetime import datetime
from pathlib import Path

# DB location — override with SANITIZER_DB_PATH (point at a mounted/durable volume in
# production). Defaults to the OS temp dir so it works cross-platform (POSIX /tmp,
# Windows %TEMP%) rather than a hardcoded POSIX /tmp path.
DB_PATH = Path(
    os.getenv("SANITIZER_DB_PATH", str(Path(tempfile.gettempdir()) / "sanitizer_analytics.db"))
)


def get_db() -> sqlite3.Connection:
    db = sqlite3.connect(str(DB_PATH))
    db.execute("""
        CREATE TABLE IF NOT EXISTS detection_counts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            category TEXT NOT NULL,
            count INTEGER NOT NULL,
            layer TEXT NOT NULL
        )
    """)
    db.commit()
    return db


def record_counts(categories: list[dict]) -> None:
    """Record anonymized detection category counts."""
    db = get_db()
    ts = datetime.utcnow().isoformat()
    for entry in categories:
        db.execute(
            "INSERT INTO detection_counts (timestamp, category, count, layer) VALUES (?, ?, ?, ?)",
            (ts, entry["category"], entry["count"], entry.get("layer", "L2")),
        )
    db.commit()
    db.close()


def export_json(start_date: str | None = None, end_date: str | None = None) -> list[dict]:
    """Export aggregated counts as JSON."""
    db = get_db()
    query = "SELECT category, SUM(count) as total, layer FROM detection_counts"
    params: list[str] = []
    conditions = []

    if start_date:
        conditions.append("timestamp >= ?")
        params.append(start_date)
    if end_date:
        conditions.append("timestamp <= ?")
        params.append(end_date)

    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " GROUP BY category, layer ORDER BY total DESC"

    rows = db.execute(query, params).fetchall()
    db.close()
    return [{"category": r[0], "total": r[1], "layer": r[2]} for r in rows]


def export_csv(start_date: str | None = None, end_date: str | None = None) -> str:
    """Export aggregated counts as CSV string."""
    data = export_json(start_date, end_date)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["category", "total", "layer"])
    writer.writeheader()
    writer.writerows(data)
    return output.getvalue()
