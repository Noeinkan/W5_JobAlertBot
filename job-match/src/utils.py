import json
import re
import time

from anthropic import APIError, APIStatusError, RateLimitError


def call_claude(
    client,
    model: str,
    system: str,
    user: str,
    max_tokens: int = 2048,
    max_retries: int = 3,
) -> str:
    """Call the Claude API with exponential backoff retry on transient errors."""
    delays = [1, 2, 4]
    last_exc = None

    for attempt, delay in enumerate(delays[:max_retries], start=1):
        try:
            msg = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            return msg.content[0].text
        except RateLimitError as exc:
            last_exc = exc
            if attempt == max_retries:
                break
            time.sleep(delay)
        except APIStatusError as exc:
            last_exc = exc
            if attempt == max_retries or exc.status_code not in {500, 502, 503, 529}:
                raise
            time.sleep(delay)
        except APIError as exc:
            raise

    raise last_exc  # type: ignore[misc]


def extract_json(text: str) -> dict:
    """Extract a JSON object from text, handling markdown code fences."""
    # Strip ```json ... ``` or ``` ... ``` fences
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence_match:
        json_str = fence_match.group(1)
    else:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start == -1 or end == 0:
            raise ValueError(
                f"No JSON object found in Claude response. Preview:\n{text[:300]}"
            )
        json_str = text[start:end]

    # Remove trailing commas before ] or } (Claude occasionally generates these)
    json_str = re.sub(r",\s*([}\]])", r"\1", json_str)

    try:
        return json.loads(json_str)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Failed to parse JSON from Claude response: {exc}\nJSON string:\n{json_str[:500]}"
        ) from exc
