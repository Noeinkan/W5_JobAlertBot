import yaml
from anthropic import Anthropic
from pydantic import ValidationError

from .config import Config
from .models import MatchVerdict, ParsedJob
from .utils import call_claude, extract_json

_SYSTEM_PROMPT = """\
You are an expert recruiter and career coach. Evaluate how well a candidate matches a job listing.
Be direct, honest, and specific. Flag dealbreakers immediately. Consider implicit requirements and
cultural signals in the job description — not just keyword matching.

Return ONLY a valid JSON object with exactly these keys:
- overall_score: integer 0-100
- verdict: one of "STRONG_MATCH", "POSSIBLE_MATCH", "WEAK_MATCH", "NOT_SUITABLE"
- scores: object with keys "skills_fit", "seniority_fit", "industry_fit", "location_fit",
  "salary_fit" (integer 1-10 or null if salary not listed), "growth_potential" (each 1-10)
- dealbreakers_triggered: array of strings (any candidate dealbreakers that apply)
- missing_skills: array of strings (skills the job requires that the candidate lacks)
- strong_matches: array of strings (areas where the candidate clearly excels vs requirements)
- rationale: string (2-3 sentence summary of the fit)
- salary_estimate_gbp: string or null (estimated range if not listed, e.g. "£70,000 - £85,000")
- red_flags: array of strings (concerns about the role or company itself)

Scoring rubric:
- 80-100 → STRONG_MATCH: meets all core requirements, minimal gaps
- 60-79  → POSSIBLE_MATCH: meets most requirements, some upskilling needed
- 40-59  → WEAK_MATCH: significant gaps, major re-skilling required
- 0-39   → NOT_SUITABLE: fundamental mismatch (wrong seniority, location, or domain)

Do not add markdown, code fences, or explanation — output ONLY the JSON object."""

_USER_TEMPLATE = """\
## CANDIDATE PROFILE
{candidate_yaml}

## JOB DETAILS
**Title:** {title}
**Company:** {company}
**Location:** {location}
**Salary:** {salary_text}

### Requirements
{requirements}

### Responsibilities
{responsibilities}

### Job Description
{description_clean}"""


def score_match(job: ParsedJob, config: Config) -> MatchVerdict:
    """Score how well the candidate profile matches the given parsed job."""
    client = Anthropic(api_key=config.api_key)

    user_message = _USER_TEMPLATE.format(
        candidate_yaml=config.profile_yaml,
        title=job.title,
        company=job.company,
        location=job.location,
        salary_text=job.salary_text or "Not specified",
        requirements="\n".join(f"- {r}" for r in job.requirements) or "Not listed",
        responsibilities="\n".join(f"- {r}" for r in job.responsibilities) or "Not listed",
        description_clean=job.description_clean[:3_000],
    )

    response = call_claude(
        client,
        model=config.model,
        system=_SYSTEM_PROMPT,
        user=user_message,
        max_tokens=1024,
    )

    data = extract_json(response)

    try:
        return MatchVerdict.model_validate(data)
    except ValidationError as exc:
        raise ValueError(
            f"Claude returned data that doesn't match the expected verdict structure:\n{exc}"
        ) from exc
