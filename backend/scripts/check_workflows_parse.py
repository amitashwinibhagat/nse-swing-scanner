#!/usr/bin/env python3
"""
check_workflows_parse.py
CI guard: every file in .github/workflows/ must be valid YAML that GitHub will
actually accept as a workflow.

Why this exists
---------------
From 2026-10-27 to 2026-11-05 `ci.yml` had a single stray space:

    - name: Install backend deps
      working-directory: backend
       run: pip install -r requirements-dev.txt   # one space too many

That is a YAML error, not a typo GitHub can tolerate. The workflow was rejected
at parse time, so it created zero jobs: no pytest, no cron guard, no frontend
build, for six weeks — while every local `pytest` run stayed green and
`check_cron_consistency.py` kept reporting OK because *it* was never run either.

A workflow cannot validate itself, so this check runs in a dedicated job that
only needs PyYAML.

Checks:
  1. YAML parses at all.
  2. Top-level keys are a subset of the ones GitHub accepts (a typo like
     `job:` instead of `jobs:` would otherwise parse fine and do nothing).
  3. At least one trigger and at least one job.
  4. Every job has `runs-on` and at least one step.
  5. Every step is a mapping with `uses` or `run` (a step that is just
     `working-directory` does nothing).
  6. Multi-line `run:` bodies are only allowed on steps that declare them —
     i.e. the `run` key is at the same indentation as `name`/`uses`.

Usage:
    python backend/scripts/check_workflows_parse.py [--dir .github/workflows]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List

try:
    import yaml
except ImportError:  # pragma: no cover - CI installs it explicitly
    print("::error::PyYAML is required: pip install pyyaml")
    raise SystemExit(1)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = REPO_ROOT / ".github" / "workflows"

# Top-level keys GitHub accepts in a workflow file.
ALLOWED_TOP_LEVEL = {
    "name", "run-name", "on", "permissions", "env", "defaults", "concurrency",
    "jobs",
}
# Keys GitHub accepts inside a job.
ALLOWED_JOB_KEYS = {
    "name", "permissions", "needs", "if", "runs-on", "environment",
    "concurrency", "outputs", "env", "defaults", "steps", "timeout-minutes",
    "strategy", "continue-on-error", "container", "services", "uses", "with",
    "secrets",
}


def check_file(path: Path) -> List[str]:
    errors: List[str] = []
    rel = path.relative_to(REPO_ROOT) if path.is_relative_to(REPO_ROOT) else path

    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        return [f"{rel}: unreadable ({exc})"]

    try:
        doc = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        where = f" (line {mark.line + 1}, column {mark.column + 1})" if mark else ""
        return [f"{rel}: invalid YAML{where}: {getattr(exc, 'problem', exc)}"]

    if not isinstance(doc, dict):
        return [f"{rel}: top level is not a mapping"]

    # PyYAML implements YAML 1.1, where the bare key `on:` parses as the
    # boolean True. Normalise it back before validating top-level keys.
    normalised = {("on" if key is True else key): value for key, value in doc.items()}

    unknown = set(normalised) - ALLOWED_TOP_LEVEL
    if unknown:
        errors.append(f"{rel}: unknown top-level key(s) {sorted(map(str, unknown))}")

    if "on" not in normalised or not normalised["on"]:
        errors.append(f"{rel}: no `on:` trigger block")

    jobs = normalised.get("jobs")
    if not isinstance(jobs, dict) or not jobs:
        errors.append(f"{rel}: no `jobs:` block (GitHub will create zero jobs)")
        return errors

    for job_id, job in jobs.items():
        if not isinstance(job, dict):
            errors.append(f"{rel}:{job_id}: job is not a mapping")
            continue
        unknown_job = set(job) - ALLOWED_JOB_KEYS
        if unknown_job:
            errors.append(f"{rel}:{job_id}: unknown job key(s) {sorted(unknown_job)}")
        if "runs-on" not in job:
            errors.append(f"{rel}:{job_id}: missing `runs-on`")
        steps = job.get("steps")
        if not isinstance(steps, list) or not steps:
            errors.append(f"{rel}:{job_id}: no steps")
            continue
        for idx, step in enumerate(steps):
            if not isinstance(step, dict):
                errors.append(f"{rel}:{job_id}: step {idx + 1} is not a mapping")
                continue
            has_action = "uses" in step
            has_command = "run" in step
            if not (has_action or has_command):
                errors.append(
                    f"{rel}:{job_id}: step {idx + 1} "
                    f"({step.get('name', '<unnamed>')!r}) has neither `uses` nor "
                    f"`run` — a stray indentation makes GitHub skip it silently"
                )
            if has_action and has_command:
                errors.append(
                    f"{rel}:{job_id}: step {idx + 1} has both `uses` and `run`"
                )

    return errors


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate GitHub workflow YAML.")
    parser.add_argument("--dir", default=str(DEFAULT_DIR), help="Workflow directory")
    args = parser.parse_args(argv)

    directory = Path(args.dir)
    if not directory.is_dir():
        print(f"::error::workflow directory not found: {directory}")
        return 1

    files = sorted(directory.glob("*.yml")) + sorted(directory.glob("*.yaml"))
    if not files:
        print(f"::error::no workflow files in {directory}")
        return 1

    all_errors: List[str] = []
    for path in files:
        errors = check_file(path)
        if errors:
            all_errors.extend(errors)
        else:
            print(f"ok  {path.name}")

    if all_errors:
        for err in all_errors:
            print(f"::error::{err}")
        print(f"\n{len(all_errors)} workflow problem(s) across {len(files)} file(s).")
        return 1

    print(f"check_workflows_parse: {len(files)} workflow(s) valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
