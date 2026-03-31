# job-match

A CLI tool that scrapes a job listing, parses it with Claude, and scores it against your candidate profile.

## Requirements

- Python 3.11+
- An Anthropic API key

## Install

```bash
cd job-match

# Install build backend first (if not already installed)
pip install hatchling

# Install the package in editable mode
pip install -e .
```

## Configuration

### 1. API key

Edit `.env` and set your key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Candidate profile

Edit `candidate_profile.yaml` with your own details. Required fields: `name`, `skills`.

## Usage

### Analyse a single URL

```bash
job-match match "https://reed.co.uk/jobs/example-bim-role"
```

### Paste text from stdin (recommended for LinkedIn)

```bash
# Copy the full job page text, then:
job-match match --text

# Or pipe a saved file:
job-match match --text < job_description.txt
```

### Save result to a file

```bash
job-match match "https://..." --output result.json
```

### Use a different candidate profile

```bash
job-match match "https://..." --profile my_other_profile.yaml
```

### Batch mode (multiple URLs)

Create a `urls.txt` file with one URL per line, then:

```bash
job-match batch urls.txt --output results.json
```

Options:
- `--delay 2.0` — seconds between requests (default: 1.0)
- `--no-cache` — re-process even if a cached result exists

## Caching

Results are cached in `.cache/<hash>.json` relative to the working directory. Re-running the same URL will use the cache unless `--no-cache` is passed.

## Optional: JavaScript-rendered pages

For pages that require JavaScript (most job boards other than LinkedIn), install Playwright:

```bash
pip install "job-match[playwright]"
playwright install chromium
```

> **LinkedIn note:** LinkedIn job pages use bot detection that blocks both standard HTTP requests and headless browsers. Use `--text` mode for LinkedIn: open the job posting in your browser, select all text (Ctrl+A), copy, then pipe it in.

## Output format

```json
{
  "job": {
    "title": "...",
    "company": "...",
    "location": "...",
    "salary_text": "...",
    "requirements": ["..."],
    "responsibilities": ["..."],
    "benefits": ["..."],
    "description_clean": "...",
    "raw_url": "..."
  },
  "verdict": {
    "overall_score": 82,
    "verdict": "STRONG_MATCH",
    "scores": {
      "skills_fit": 9,
      "seniority_fit": 8,
      "industry_fit": 7,
      "location_fit": 10,
      "salary_fit": 8,
      "growth_potential": 7
    },
    "dealbreakers_triggered": [],
    "missing_skills": ["Bentley OpenBuildings"],
    "strong_matches": ["ISO 19650 expertise", "ACC platform experience"],
    "rationale": "Strong technical alignment with BIM management requirements...",
    "salary_estimate_gbp": "£90,000 - £110,000",
    "red_flags": []
  }
}
```
