import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Optional

import typer
from pydantic import ValidationError
from rich import print as rprint
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .config import load_config
from .matcher import score_match
from .models import MatchVerdict, ParsedJob
from .parser import parse_job
from .scraper import ScrapingError, read_stdin, scrape_url

app = typer.Typer(
    help="Score job listings against your candidate profile using Claude.",
    no_args_is_help=True,
)
console = Console()

CACHE_DIR = Path(".cache")

_VERDICT_COLORS = {
    "STRONG_MATCH": "bold green",
    "POSSIBLE_MATCH": "yellow",
    "WEAK_MATCH": "orange3",
    "NOT_SUITABLE": "bold red",
}

_DEFAULT_PROFILE = Path("candidate_profile.yaml")


@app.command()
def match(
    url: Optional[str] = typer.Argument(None, help="Job listing URL to analyse"),
    text: bool = typer.Option(False, "--text", help="Read job description from stdin instead of a URL"),
    profile: Path = typer.Option(
        _DEFAULT_PROFILE, "--profile", "-p", help="Path to candidate profile YAML"
    ),
    output: Optional[Path] = typer.Option(
        None, "--output", "-o", help="Write full JSON result to this file"
    ),
    no_cache: bool = typer.Option(False, "--no-cache", help="Skip cache lookup and re-process"),
) -> None:
    """Analyse a single job listing and output a match verdict."""
    config = load_config(profile)
    cache_key: Optional[str] = None

    if text:
        rprint("[dim]Reading job description from stdin...[/dim]")
        raw_text = read_stdin()
        if not raw_text:
            rprint("[bold red]Error:[/bold red] No input received on stdin.")
            raise typer.Exit(1)
    elif url:
        cache_key = _url_cache_key(url)
        if not no_cache:
            cached = _load_cache(cache_key)
            if cached:
                rprint("[dim]Using cached result.[/dim]")
                _render_from_dict(cached)
                if output:
                    _write_output(output, cached)
                return
        with console.status("[bold cyan]Fetching job listing...[/bold cyan]"):
            try:
                raw_text = scrape_url(url)
            except ScrapingError as exc:
                rprint(f"[bold red]Scraping failed:[/bold red] {exc}")
                raise typer.Exit(1)
    else:
        rprint("[bold red]Error:[/bold red] Provide a URL or use --text for stdin input.")
        raise typer.Exit(1)

    with console.status("[bold cyan]Parsing job description with Claude...[/bold cyan]"):
        try:
            parsed = parse_job(raw_text, config, url=url)
        except (ValueError, ValidationError) as exc:
            rprint(f"[bold red]Parsing failed:[/bold red] {exc}")
            raise typer.Exit(1)

    with console.status("[bold cyan]Scoring match with Claude...[/bold cyan]"):
        try:
            verdict = score_match(parsed, config)
        except (ValueError, ValidationError) as exc:
            rprint(f"[bold red]Scoring failed:[/bold red] {exc}")
            raise typer.Exit(1)

    result = {
        "job": parsed.model_dump(),
        "verdict": verdict.model_dump(),
    }

    if cache_key:
        _save_cache(cache_key, result)

    _render_verdict(parsed, verdict)

    if output:
        _write_output(output, result)


@app.command()
def batch(
    urls_file: Path = typer.Argument(..., help="Text file with one job URL per line"),
    profile: Path = typer.Option(
        _DEFAULT_PROFILE, "--profile", "-p", help="Path to candidate profile YAML"
    ),
    output: Optional[Path] = typer.Option(
        None, "--output", "-o", help="Write all results as JSON array to this file"
    ),
    delay: float = typer.Option(1.0, "--delay", help="Seconds to wait between jobs"),
    no_cache: bool = typer.Option(False, "--no-cache", help="Skip cache lookup"),
) -> None:
    """Process multiple job URLs from a file and show a ranked summary table."""
    if not urls_file.exists():
        rprint(f"[bold red]Error:[/bold red] File not found: {urls_file}")
        raise typer.Exit(1)

    urls = [u.strip() for u in urls_file.read_text(encoding="utf-8").splitlines() if u.strip()]
    if not urls:
        rprint("[bold red]Error:[/bold red] No URLs found in file.")
        raise typer.Exit(1)

    config = load_config(profile)
    results = []

    rprint(f"\nProcessing [bold]{len(urls)}[/bold] job(s)...\n")

    with typer.progressbar(urls, label="Analysing", show_eta=True) as progress:
        for url in progress:
            cache_key = _url_cache_key(url)

            if not no_cache:
                cached = _load_cache(cache_key)
                if cached:
                    results.append(cached)
                    continue

            try:
                raw_text = scrape_url(url)
            except ScrapingError as exc:
                rprint(f"\n[yellow]Skipping {url}:[/yellow] {exc}")
                continue

            try:
                parsed = parse_job(raw_text, config, url=url)
                verdict = score_match(parsed, config)
            except (ValueError, ValidationError) as exc:
                rprint(f"\n[yellow]Skipping {url}:[/yellow] {exc}")
                continue

            result = {
                "job": parsed.model_dump(),
                "verdict": verdict.model_dump(),
            }
            _save_cache(cache_key, result)
            results.append(result)

            if delay > 0:
                time.sleep(delay)

    if not results:
        rprint("\n[yellow]No results to display.[/yellow]")
        return

    _render_summary_table(results)

    if output:
        _write_output(output, results)


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------

def _render_verdict(job: ParsedJob, verdict: MatchVerdict) -> None:
    verdict_str = str(verdict.verdict)
    color = _VERDICT_COLORS.get(verdict_str, "white")

    rprint(f"\n[bold]{job.title}[/bold] @ {job.company}  ·  {job.location}")
    if job.salary_text:
        rprint(f"Salary: {job.salary_text}")
    elif verdict.salary_estimate_gbp:
        rprint(f"Estimated salary: {verdict.salary_estimate_gbp}")

    rprint(
        f"\n[{color}]{verdict_str}[/{color}]  "
        f"Overall: [bold]{verdict.overall_score}/100[/bold]"
    )

    # Score breakdown
    if verdict.scores:
        score_parts = "  ".join(f"{k}: {v}" for k, v in verdict.scores.items() if v is not None)
        rprint(f"[dim]{score_parts}[/dim]")

    rprint(f"\n[italic]{verdict.rationale}[/italic]")

    if verdict.dealbreakers_triggered:
        rprint("\n[bold red]Dealbreakers:[/bold red]")
        for d in verdict.dealbreakers_triggered:
            rprint(f"  [red]✗[/red] {d}")

    if verdict.strong_matches:
        rprint("\n[bold green]Strong matches:[/bold green]")
        for s in verdict.strong_matches:
            rprint(f"  [green]✓[/green] {s}")

    if verdict.missing_skills:
        rprint("\n[yellow]Missing skills:[/yellow]")
        for s in verdict.missing_skills:
            rprint(f"  [yellow]·[/yellow] {s}")

    if verdict.red_flags:
        rprint("\n[orange3]Red flags:[/orange3]")
        for r in verdict.red_flags:
            rprint(f"  [orange3]![/orange3] {r}")


def _render_from_dict(result: dict) -> None:
    try:
        parsed = ParsedJob.model_validate(result["job"])
        verdict = MatchVerdict.model_validate(result["verdict"])
        _render_verdict(parsed, verdict)
    except Exception:
        rprint(json.dumps(result, indent=2))


def _render_summary_table(results: list[dict]) -> None:
    sorted_results = sorted(
        results,
        key=lambda r: r.get("verdict", {}).get("overall_score", 0),
        reverse=True,
    )

    table = Table(title="Batch Results (ranked by score)", show_header=True, header_style="bold")
    table.add_column("Score", width=6, justify="right")
    table.add_column("Verdict", width=16)
    table.add_column("Title", width=40, no_wrap=False)
    table.add_column("Company", width=25)
    table.add_column("Location", width=20)

    for r in sorted_results:
        v = r.get("verdict", {})
        j = r.get("job", {})
        verdict_str = str(v.get("verdict", ""))
        color = _VERDICT_COLORS.get(verdict_str, "white")
        table.add_row(
            str(v.get("overall_score", "?")),
            f"[{color}]{verdict_str}[/{color}]",
            j.get("title", ""),
            j.get("company", ""),
            j.get("location", ""),
        )

    console.print()
    console.print(table)


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _url_cache_key(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def _load_cache(key: str) -> Optional[dict]:
    path = CACHE_DIR / f"{key}.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
    return None


def _save_cache(key: str, data: dict) -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    (CACHE_DIR / f"{key}.json").write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def _write_output(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    rprint(f"\n[dim]Result saved to {path}[/dim]")
