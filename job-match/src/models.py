from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class VerdictEnum(str, Enum):
    STRONG_MATCH = "STRONG_MATCH"
    POSSIBLE_MATCH = "POSSIBLE_MATCH"
    WEAK_MATCH = "WEAK_MATCH"
    NOT_SUITABLE = "NOT_SUITABLE"


class ParsedJob(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str
    company: str
    location: str
    salary_text: Optional[str] = None
    requirements: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    benefits: list[str] = Field(default_factory=list)
    description_clean: str
    raw_url: Optional[str] = None


class MatchVerdict(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    overall_score: int = Field(ge=0, le=100)
    verdict: VerdictEnum
    scores: dict[str, int]
    dealbreakers_triggered: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    strong_matches: list[str] = Field(default_factory=list)
    rationale: str
    salary_estimate_gbp: Optional[str] = None
    red_flags: list[str] = Field(default_factory=list)
