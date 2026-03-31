import re
import sys
from typing import Optional

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
}

MIN_CONTENT_CHARS = 200
REQUEST_TIMEOUT = 20

# CSS selectors tried in priority order to find the main job content area
_CONTENT_SELECTORS = [
    "article",
    "main",
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[id*="job-description"]',
    '[class*="jobDetails"]',
    '[class*="job-details"]',
    '[class*="description"]',
    '[class*="content"]',
]


class ScrapingError(Exception):
    pass


def scrape_url(url: str) -> str:
    """Fetch a job listing URL and return cleaned plain text.

    Tries requests+BeautifulSoup first. Falls back to Playwright if the
    page appears JS-rendered (content too short after parsing).
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise ScrapingError(f"HTTP request failed: {exc}") from exc

    text = _extract_text(resp.text)
    if len(text) >= MIN_CONTENT_CHARS:
        return text

    # Page likely requires JavaScript — attempt Playwright fallback
    return _playwright_scrape(url)


def _extract_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    # Remove noise elements
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
        tag.decompose()

    # Try semantic content selectors in priority order
    for selector in _CONTENT_SELECTORS:
        node = soup.select_one(selector)
        if node:
            return _clean(node.get_text(separator=" "))

    # Fall back to full body text
    return _clean(soup.get_text(separator=" "))


def _clean(text: str) -> str:
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _playwright_scrape(url: str) -> str:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise ScrapingError(
            "The page appears to be JavaScript-rendered but Playwright is not installed.\n"
            "To install: pip install 'job-match[playwright]' && playwright install chromium\n"
            "Alternatively, use --text to paste the job description directly:\n"
            "  job-match match --text < job_description.txt"
        )

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.set_extra_http_headers(HEADERS)
            page.goto(url, wait_until="networkidle", timeout=30_000)
            text = page.inner_text("body")
            browser.close()
        return _clean(text)
    except Exception as exc:
        raise ScrapingError(
            f"Playwright scraping failed: {exc}\n"
            "Try --text mode instead: job-match match --text < job_description.txt"
        ) from exc


def read_stdin() -> str:
    """Read job description text from stdin (for --text mode)."""
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    return sys.stdin.read().strip()
