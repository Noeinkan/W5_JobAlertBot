import os
from pathlib import Path

import yaml
from dotenv import load_dotenv

load_dotenv()


class Config:
    def __init__(self, profile_path: Path):
        self.api_key = self._require_env("ANTHROPIC_API_KEY")
        self.model = "claude-sonnet-4-6"
        self.profile = self._load_profile(profile_path)
        self.profile_yaml = self._profile_as_yaml(self.profile)

    @staticmethod
    def _require_env(key: str) -> str:
        value = os.environ.get(key)
        if not value:
            raise SystemExit(
                f"[error] Missing {key}.\n"
                f"Create a .env file in the job-match directory with:\n"
                f"  {key}=sk-ant-..."
            )
        return value

    @staticmethod
    def _load_profile(path: Path) -> dict:
        if not path.exists():
            raise SystemExit(
                f"[error] Candidate profile not found: {path}\n"
                "Create candidate_profile.yaml or pass --profile <path>"
            )
        with path.open(encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if not isinstance(data, dict):
            raise SystemExit(f"[error] candidate_profile.yaml must be a YAML mapping, got: {type(data)}")
        required = {"name", "skills"}
        missing = required - set(data.keys())
        if missing:
            raise SystemExit(
                f"[error] candidate_profile.yaml is missing required fields: {', '.join(sorted(missing))}"
            )
        return data

    @staticmethod
    def _profile_as_yaml(profile: dict) -> str:
        return yaml.dump(profile, default_flow_style=False, allow_unicode=True, sort_keys=False)


def load_config(profile_path: Path) -> Config:
    return Config(profile_path)
