"""Tests for the analytics SQLite aggregation (stdlib only — no Presidio/spaCy)."""

from app import analytics


def test_record_and_export_json(tmp_path, monkeypatch):
    monkeypatch.setattr(analytics, "DB_PATH", tmp_path / "analytics.db")

    analytics.record_counts([
        {"category": "EMAIL_ADDRESS", "count": 2, "layer": "L2"},
        {"category": "PERSON", "count": 1, "layer": "L2"},
    ])
    analytics.record_counts([{"category": "EMAIL_ADDRESS", "count": 3, "layer": "L2"}])

    rows = analytics.export_json()
    by_category = {r["category"]: r["total"] for r in rows}
    assert by_category["EMAIL_ADDRESS"] == 5  # summed across records
    assert by_category["PERSON"] == 1


def test_export_csv_has_header_and_rows(tmp_path, monkeypatch):
    monkeypatch.setattr(analytics, "DB_PATH", tmp_path / "analytics.db")
    analytics.record_counts([{"category": "UTORID", "count": 1, "layer": "L2"}])

    csv_text = analytics.export_csv()
    assert "category,total,layer" in csv_text
    assert "UTORID" in csv_text


def test_layer_defaults_to_l2_when_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(analytics, "DB_PATH", tmp_path / "analytics.db")
    analytics.record_counts([{"category": "PHONE_NUMBER", "count": 1}])

    rows = analytics.export_json()
    assert rows[0]["layer"] == "L2"
