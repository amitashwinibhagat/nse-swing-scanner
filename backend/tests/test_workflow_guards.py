"""Tests for the CI guards themselves.

A guard that cannot catch the failure it exists for is worse than no guard: it
manufactures confidence. Both of these were written after real incidents.
"""

import subprocess
import sys
import textwrap
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
SCRIPTS = BACKEND / "scripts"

sys.path.insert(0, str(SCRIPTS))

import check_workflows_parse  # noqa: E402


def _write(tmp_path: Path, text: str) -> Path:
    p = tmp_path / "wf.yml"
    p.write_text(textwrap.dedent(text))
    return p


def test_valid_workflow_passes(tmp_path):
    p = _write(tmp_path, """
        name: ok
        on:
          push:
        jobs:
          build:
            runs-on: ubuntu-latest
            steps:
              - uses: actions/checkout@v7
              - name: Run
                run: echo hi
    """)
    assert check_workflows_parse.check_file(p) == []


def test_the_original_ci_typo_is_caught(tmp_path):
    """One stray space under `working-directory:` made the whole workflow
    invalid YAML and GitHub created ZERO jobs for six weeks."""
    p = _write(tmp_path, """
        name: broken
        on:
          push:
        jobs:
          backend:
            runs-on: ubuntu-latest
            steps:
              - name: Install
                working-directory: backend
                 run: pip install -r requirements.txt
    """)
    errors = check_workflows_parse.check_file(p)
    assert errors
    assert "invalid YAML" in errors[0]


def test_misspelled_jobs_key_is_caught(tmp_path):
    p = _write(tmp_path, """
        name: broken
        on:
          push:
        job:
          build:
            runs-on: ubuntu-latest
    """)
    errors = check_workflows_parse.check_file(p)
    assert any("jobs" in e for e in errors)


def test_step_without_run_or_uses_is_caught(tmp_path):
    p = _write(tmp_path, """
        name: broken
        on:
          push:
        jobs:
          build:
            runs-on: ubuntu-latest
            steps:
              - name: Orphan
                working-directory: backend
    """)
    errors = check_workflows_parse.check_file(p)
    assert any("neither `uses` nor `run`" in e for e in errors)


def test_repository_workflows_are_valid():
    """The real files must pass their own guard."""
    for wf in sorted((BACKEND.parent / ".github" / "workflows").glob("*.yml")):
        assert check_workflows_parse.check_file(wf) == [], wf.name


def test_cron_guard_runs_clean():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "check_cron_consistency.py")],
        cwd=str(BACKEND), capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_workflow_script_guard_covers_every_entrypoint():
    """Every script a workflow invokes must be exercised by the guard."""
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "check_workflow_scripts.py")],
        cwd=str(BACKEND), capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "write_scan_status.py" in proc.stdout


# --- workflow-step assertions ---------------------------------------------

REPO = BACKEND.parent


def _workflow(name):
    import yaml
    with open(REPO / ".github" / "workflows" / name) as fh:
        return yaml.safe_load(fh)


def _steps(wf, job):
    return _workflow(wf)["jobs"][job]["steps"]


def _step(wf, job, name):
    for step in _steps(wf, job):
        if step.get("name") == name:
            return step
    raise AssertionError(f"step {name!r} not found in {wf}:{job}")


def test_watchdog_passes_gh_token_to_the_run_state_step():
    """`gh` does not inherit GITHUB_TOKEN. Without it `gh run list` failed on
    every tick and run_state was permanently "none"."""
    step = _step("watchdog.yml", "check", "Determine scan run state + latest_scan.json age on main")
    assert "GH_TOKEN" in (step.get("env") or {})


def _executable_lines(run: str):
    """Drop blank lines and comments so assertions target what actually runs."""
    out = []
    for line in run.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        out.append(stripped)
    return out


def test_watchdog_does_not_swallow_a_gh_failure():
    step = _step("watchdog.yml", "check", "Determine scan run state + latest_scan.json age on main")
    code = "\n".join(_executable_lines(step["run"]))
    assert '|| echo "none"' not in code
    assert "run_state=unknown" in code
    assert "refusing to trigger" in code


def test_success_ping_is_the_last_step():
    """It used to fire right after the scanner, so a failure in validation,
    commit or deploy still reported green to healthchecks.io."""
    steps = _steps("scan.yml", "scan")
    names = [s.get("name") for s in steps]
    success_idx = names.index("Ping healthchecks.io (scan succeeded)")
    for later in ("Validate JSON contract", "Commit and push updated scan",
                  "Build frontend (for Netlify deploy)", "Deploy to Netlify"):
        assert names.index(later) < success_idx, f"{later} runs after the success ping"


def test_netlify_deploy_uses_absolute_paths_and_pins_a_version():
    """netlify.toml sets `base = "frontend"`, so relative --dir paths resolve
    under frontend/ and silently point at a missing directory."""
    step = _step("scan.yml", "scan", "Deploy to Netlify")
    run = step["run"]
    assert '--dir="$PWD/frontend/dist"' in run
    assert "--site=" in run
    assert "netlify-cli@" in run and "netlify-cli@latest" not in run


def test_scan_steps_commit_paths_one_at_a_time():
    """A multi-path `git add` stages nothing if any path is missing."""
    step = _step("scan.yml", "scan", "Commit and push updated scan")
    for line in _executable_lines(step["run"]):
        if not line.startswith("git add "):
            continue
        body = line.split("||", 1)[0].strip()
        paths = body.split()[2:]
        assert len(paths) <= 1, f"multi-path git add: {line}"


def test_scan_workflow_accepts_a_repository_dispatch_trigger():
    """The GitHub schedule is hours late; an external scheduler needs a door."""
    assert "repository_dispatch" in _workflow("scan.yml")[True] or \
        "repository_dispatch" in _workflow("scan.yml").get("on", {})


def test_netlify_scheduled_functions_match_the_scan_windows():
    """The punctual trigger is a THIRD copy of the schedule (scan.yml,
    settings.py, netlify.toml). If they drift, the "on time" run fires at the
    wrong time and the fallback covers for it — silently."""
    import re
    from settings import SCAN_WINDOWS_UTC
    from scan_schedule import scheduled_cron_string

    toml = (REPO / "netlify.toml").read_text()
    found = sorted(
        cron
        for _, cron in re.findall(
            r'\[functions\."([^"]+)"\]\s*\n\s*schedule\s*=\s*"([^"]+)"', toml
        )
    )
    expected = sorted(scheduled_cron_string([w]) for w in SCAN_WINDOWS_UTC)
    assert found == expected


def test_each_scheduled_function_declares_its_own_cron():
    fns = REPO / "frontend" / "netlify" / "functions"
    morning = (fns / "scheduled-scan-morning.mjs").read_text()
    evening = (fns / "scheduled-scan-evening.mjs").read_text()
    assert 'schedule: "30 3 * * 1-5"' in morning
    assert 'schedule: "30 10 * * 1-5"' in evening
    assert 'runScheduledWindow("03:30")' in morning
    assert 'runScheduledWindow("10:30")' in evening


def test_scan_workflow_skips_a_window_that_is_already_covered():
    """GitHub's cron can arrive hours after the punctual trigger for the SAME
    window; without this guard it would scan and commit a second time.

    The decision lives in scripts/resolve_schedule_context.py (covered by
    test_resolve_schedule_context.py); here we assert the wiring."""
    step = _step("scan.yml", "scan", "Resolve schedule context")
    assert "resolve_schedule_context.py" in step["run"]
    # The skip decision must guard the scan itself, not just the commit.
    scan_step = _step("scan.yml", "scan", "Run full scan")
    assert "skip" in (scan_step.get("if") or "")
    # ...and every step that would publish or deploy from it.
    for later in (
        "Write dated snapshot + history index (B1)",
        "Write scan_status.json",
        "Commit and push updated scan",
        "Build frontend (for Netlify deploy)",
        "Deploy to Netlify",
        "Verify the deployed site serves this scan",
    ):
        assert "skip" in (_step("scan.yml", "scan", later).get("if") or ""), later


def test_scan_workflow_accepts_a_window_from_the_dispatch_payload():
    step = _step("scan.yml", "scan", "Resolve schedule context")
    env_values = " ".join(str(v) for v in (step.get("env") or {}).values())
    assert "client_payload.window" in env_values
