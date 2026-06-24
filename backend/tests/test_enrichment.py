"""Tests for explanation/severity enrichment (no Presidio/spaCy required)."""

from app.enrichment import enrich


def test_known_entity_has_title_and_severity():
    r = enrich("PERSON")
    assert r["severity"] == "high"
    assert r["title"] == "Person Name"
    assert r["action"]


def test_unknown_entity_falls_back_to_medium():
    r = enrich("SOME_NEW_ENTITY")
    assert r["severity"] == "medium"
    assert r["title"]  # generated, non-empty
    assert "SOME_NEW_ENTITY" in r["action"]


def test_severity_map_covers_expected_buckets():
    assert enrich("CA_SOCIAL_INSURANCE_NUMBER")["severity"] == "high"
    assert enrich("EMAIL_ADDRESS")["severity"] == "medium"
    assert enrich("ORGANIZATION")["severity"] == "low"
    assert enrich("GRANT_NUMBER")["severity"] == "low"
