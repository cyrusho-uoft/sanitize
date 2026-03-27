"""Custom Presidio recognizers for U of T-specific PII patterns."""

from presidio_analyzer import PatternRecognizer, Pattern


# UTORid: 2-8 lowercase letters + 1-4 digits
utorid_recognizer = PatternRecognizer(
    supported_entity="UTORID",
    name="UofT UTORid Recognizer",
    patterns=[
        Pattern(
            name="utorid",
            regex=r"\b[a-z]{2,8}\d{1,4}\b",
            score=0.4,  # Low base score — boosted by context
        )
    ],
    context=["utorid", "utoronto", "acorn", "quercus", "uoft", "u of t"],
    supported_language="en",
)

# U of T Student Number: 10 digits starting with 100
student_number_recognizer = PatternRecognizer(
    supported_entity="STUDENT_NUMBER",
    name="UofT Student Number Recognizer",
    patterns=[
        Pattern(
            name="student_number",
            regex=r"\b100\d{7}\b",
            score=0.85,
        )
    ],
    context=["student", "student number", "student id", "acorn", "enrollment"],
    supported_language="en",
)

# U of T Employee ID
employee_id_recognizer = PatternRecognizer(
    supported_entity="EMPLOYEE_ID",
    name="UofT Employee ID Recognizer",
    patterns=[
        Pattern(
            name="employee_id_t",
            regex=r"\bT\d{7}\b",
            score=0.7,
        )
    ],
    context=["employee", "employee id", "staff", "hr", "payroll"],
    supported_language="en",
)

# Research Grant Number (NSERC, CIHR, SSHRC patterns)
grant_number_recognizer = PatternRecognizer(
    supported_entity="GRANT_NUMBER",
    name="Research Grant Number Recognizer",
    patterns=[
        Pattern(
            name="nserc_grant",
            regex=r"\b(?:NSERC|CIHR|SSHRC)[-\s]?\d{4,8}\b",
            score=0.8,
        ),
        Pattern(
            name="tri_council_grant",
            regex=r"\b\d{3,4}[-]\d{4,6}\b",
            score=0.3,  # Low score unless context present
        ),
    ],
    context=["grant", "funding", "research", "nserc", "cihr", "sshrc", "award"],
    supported_language="en",
)

ALL_RECOGNIZERS = [
    utorid_recognizer,
    student_number_recognizer,
    employee_id_recognizer,
    grant_number_recognizer,
]
