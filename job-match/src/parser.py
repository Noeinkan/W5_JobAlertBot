from typing import Optional

from anthropic import Anthropic
from pydantic import ValidationError

from .config import Config
from .models import ParsedJob
from .utils import call_claude, extract_json

_SYSTEM_PROMPT = """\
You are a job listing parser. Extract structured data from the raw job listing text provided.
Return ONLY a valid JSON object with exactly these keys:
- title: string (job title)
- company: string (company name)
- location: string (city/region/remote)
- salary_text: string or null (salary as stated, e.g. "£60,000 - £75,000 per year")
- requirements: array of strings (skills, qualifications, years of experience required)
- responsibilities: array of strings (key duties and responsibilities)
- benefits: array of strings (perks, benefits, what they offer)
- description_clean: string (concise 2-3 paragraph summary of the role)

Rules:
- If a field is absent from the listing, use null for strings and [] for arrays.
- Do not add markdown, code fences, or any explanation — output ONLY the JSON object.
- Keep list items concise (one sentence each).
- For description_clean, write a clean summary — do not copy-paste the full listing."""


def parse_job(raw_text: str, config: Config, url: Optional[str] = None) -> ParsedJob:
    """Send raw scraped text to Claude and return a structured ParsedJob."""
    client = Anthropic(api_key=config.api_key)

    # Cap input to avoid very large token counts for the parsing step
    truncated = raw_text[:12_000] if len(raw_text) > 12_000 else raw_text

    response = call_claude(
        client,
        model=config.model,
        system=_SYSTEM_PROMPT,
        user=truncated,
        max_tokens=2048,
    )

    data = extract_json(response)
    data["raw_url"] = url

    try:
        return ParsedJob.model_validate(data)
    except ValidationError as exc:
        # Provide a clear error if Claude returned an unexpected structure
        raise ValueError(
            f"Claude returned data that doesn't match the expected job structure:\n{exc}"
        ) from exc
