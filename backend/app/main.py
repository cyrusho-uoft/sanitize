"""FastAPI gateway — orchestrates Presidio + enriches with explanations."""

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

from app.enrichment import enrich
from app.analytics import record_counts, export_json, export_csv
from app.recognizers.uoft import ALL_RECOGNIZERS

app = FastAPI(
    title="U of T Prompt Sanitizer API",
    version="0.1.0",
    description="Layer 2 PII detection gateway — on-premises Presidio NER + U of T custom recognizers",
)

# CORS — allow extension origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production: restrict to extension ID + campus IPs
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# Initialize Presidio with custom recognizers
analyzer = AnalyzerEngine()
for recognizer in ALL_RECOGNIZERS:
    analyzer.registry.add_recognizer(recognizer)

anonymizer = AnonymizerEngine()


class ScanRequest(BaseModel):
    text: str
    language: str = "en"


class AnonymizeRequest(BaseModel):
    text: str
    entities: list[dict] | None = None
    language: str = "en"


class AnalyticsRequest(BaseModel):
    categories: list[dict]


@app.get("/healthz")
def health_check():
    return {"status": "ok", "layer": "L2", "engine": "presidio"}


@app.post("/api/v1/scan")
def scan(req: ScanRequest):
    """Analyze text for PII using Presidio NER + custom recognizers."""
    results = analyzer.analyze(text=req.text, language=req.language)

    detections = []
    for r in results:
        explanation = enrich(r.entity_type)
        detections.append({
            "type": r.entity_type,
            "value": req.text[r.start:r.end],
            "start": r.start,
            "end": r.end,
            "severity": explanation["severity"],
            "layer": "L2",
            "confidence": round(r.score, 2),
            "explanationKey": r.entity_type,
            "explanation": explanation,
        })

    return {
        "detections": detections,
        "count": len(detections),
        "language": req.language,
    }


@app.post("/api/v1/anonymize")
def anonymize_text(req: AnonymizeRequest):
    """Anonymize text using Presidio — replace PII with semantic placeholders."""
    results = analyzer.analyze(text=req.text, language=req.language)

    # Build operator config for semantic placeholders
    type_counts: dict[str, int] = {}
    operators: dict[str, OperatorConfig] = {}
    for r in sorted(results, key=lambda x: x.start):
        entity = r.entity_type
        type_counts[entity] = type_counts.get(entity, 0) + 1
        label = entity.replace("_", " ").upper()
        operators[entity] = OperatorConfig(
            "replace", {"new_value": f"[{label}_{type_counts[entity]}]"}
        )

    anonymized = anonymizer.anonymize(
        text=req.text,
        analyzer_results=results,
        operators=operators,
    )

    return {
        "text": anonymized.text,
        "items_anonymized": len(results),
    }


@app.post("/api/v1/analytics")
def record_analytics(req: AnalyticsRequest):
    """Record anonymized detection category counts."""
    record_counts(req.categories)
    return {"status": "recorded", "count": len(req.categories)}


@app.get("/api/v1/analytics/export")
def export_analytics(format: str = "json", start_date: str | None = None, end_date: str | None = None):
    """Export aggregated analytics as JSON or CSV."""
    if format == "csv":
        return Response(
            content=export_csv(start_date, end_date),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=sanitizer-analytics.csv"},
        )
    return export_json(start_date, end_date)
