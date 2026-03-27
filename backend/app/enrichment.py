"""Explanation enrichment — maps entity types to educational content."""

EXPLANATIONS: dict[str, dict[str, str]] = {
    "PERSON": {
        "title": "Person Name",
        "why": "Full names combined with institutional context uniquely identify individuals. Detected by AI-powered name recognition.",
        "action": "This will be replaced with [PERSON_N].",
    },
    "LOCATION": {
        "title": "Location",
        "why": "Addresses and specific locations can identify individuals when combined with other information like role or department.",
        "action": "This will be replaced with [LOCATION_N].",
    },
    "ORGANIZATION": {
        "title": "Organization",
        "why": "Organization names narrow identification when combined with role, department, or other context.",
        "action": "This will be replaced with [ORG_N].",
    },
    "EMAIL_ADDRESS": {
        "title": "Email Address",
        "why": "Email addresses are directly linkable to identity, accounts, and institutional records.",
        "action": "This will be replaced with [EMAIL_N].",
    },
    "PHONE_NUMBER": {
        "title": "Phone Number",
        "why": "Phone numbers can be used for social engineering, SIM swapping, and unauthorized account access.",
        "action": "This will be replaced with [PHONE_N].",
    },
    "CREDIT_CARD": {
        "title": "Credit Card Number",
        "why": "Credit card numbers enable unauthorized purchases and financial fraud.",
        "action": "This will be replaced with [CREDIT_CARD_N].",
    },
    "CA_SOCIAL_INSURANCE_NUMBER": {
        "title": "Social Insurance Number",
        "why": "SINs are permanent identifiers tied to tax records, employment, and benefits. Exposure enables identity theft.",
        "action": "This will be replaced with [SIN_REDACTED].",
    },
    "UTORID": {
        "title": "UTORid",
        "why": "UTORids are U of T login credentials for ACORN, Quercus, email, and all university services.",
        "action": "This will be replaced with [UTORID_N].",
    },
    "STUDENT_NUMBER": {
        "title": "U of T Student Number",
        "why": "Student numbers are linked to academic records — grades, enrollment, financial aid.",
        "action": "This will be replaced with [STUDENT_ID_N].",
    },
    "EMPLOYEE_ID": {
        "title": "U of T Employee ID",
        "why": "Employee IDs are linked to HR records, payroll, and internal systems.",
        "action": "This will be replaced with [EMPLOYEE_ID_N].",
    },
    "GRANT_NUMBER": {
        "title": "Research Grant Number",
        "why": "Grant numbers link to funding records and can identify principal investigators.",
        "action": "This will be replaced with [GRANT_N].",
    },
}

SEVERITY_MAP: dict[str, str] = {
    "PERSON": "high",
    "CA_SOCIAL_INSURANCE_NUMBER": "high",
    "STUDENT_NUMBER": "high",
    "CREDIT_CARD": "high",
    "EMAIL_ADDRESS": "medium",
    "PHONE_NUMBER": "medium",
    "UTORID": "medium",
    "EMPLOYEE_ID": "medium",
    "LOCATION": "medium",
    "ORGANIZATION": "low",
    "GRANT_NUMBER": "low",
}


def enrich(entity_type: str) -> dict:
    """Return explanation + severity for an entity type."""
    explanation = EXPLANATIONS.get(entity_type, {
        "title": entity_type.replace("_", " ").title(),
        "why": "This information could identify you or others.",
        "action": f"This will be replaced with [{entity_type}_N].",
    })
    severity = SEVERITY_MAP.get(entity_type, "medium")
    return {**explanation, "severity": severity}
