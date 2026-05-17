#!/usr/bin/env python3
"""
Multi-agent development script for the GoPro Scoreboard feature.

Architecture (development time):
  OrchestratorAgent  ←→  Anthropic API (claude-sonnet-4-6)
       └── WorkerAgent   ←→  Anthropic API (claude-sonnet-4-6)

Usage:
  python dev_agents.py              # run and write files
  python dev_agents.py --dry-run    # plan only, no writes
  python dev_agents.py --task api/score.ts   # single task
"""

from __future__ import annotations

import anthropic
import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.rule import Rule
from rich.text import Text

REPO_ROOT = Path(__file__).parent.parent
MODEL     = "claude-sonnet-4-6"
MAX_ORCHESTRATOR_STEPS = 24
MAX_WORKER_STEPS       = 12
VERBOSE    = False
DRY_RUN    = False

_console = Console(highlight=False)


# ─── Terminal UI ──────────────────────────────────────────────────────────────

class AgentUI:
    """Coloured, animated terminal display for the two-agent session."""

    # column widths for the two-panel layout
    W = 68

    def header(self) -> None:
        _console.print()
        _console.print(Rule(
            "[bold cyan]🏓  GoPro Scoreboard[/]  [dim]·[/]  "
            "[bold white]Multi-Agent Dev Session[/]",
            style="cyan",
        ))
        _console.print()

    # ── Orchestrator events ───────────────────────────────────────────────────

    def orch_step(self, step: int, total: int) -> None:
        _console.print(
            f"\n[cyan bold]🤖 Orchestrator[/]  "
            f"[dim]step {step}/{total}[/]"
        )

    def orch_thinking(self, text: str) -> None:
        if not VERBOSE:
            return
        short = " ".join(text.split())[:260]
        _console.print(Panel(
            f"[italic dim]{short}[/]",
            title="[cyan]💭 thinking[/]",
            border_style="cyan",
            box=box.ROUNDED,
            width=self.W,
            padding=(0, 1),
        ))

    def orch_tool(self, name: str, preview: str) -> None:
        if not VERBOSE:
            return
        _console.print(
            f"  [cyan]🤖 ──▶[/]  [bold]{name}[/]  [dim]{preview[:72]}[/]"
        )

    def orch_result(self, summary: str) -> None:
        if not VERBOSE:
            return
        _console.print(f"  [dim]     ✓  {summary[:100]}[/]")

    # ── Delegation arrow (always shown) ──────────────────────────────────────

    def delegate(self, task_id: str) -> None:
        _console.print()
        _console.print(
            "  [cyan bold]🤖[/]  "
            "[cyan]━━━━━━━━━━ delegate ━━━━━━━━━▶[/]  "
            "[yellow bold]🔧[/]"
        )
        _console.print(f"  [dim]                 task:[/] [bold]{task_id}[/]")

    def delegate_result(self, task_id: str, files: list[str], ok: bool) -> None:
        status = "[green]OK[/]" if ok else "[red]FAILED[/]"
        _console.print(
            "  [cyan bold]🤖[/]  "
            "[cyan]◀━━━━━━━━━━ result ━━━━━━━━━━[/]  "
            "[yellow bold]🔧[/]"
        )
        _console.print(
            f"  [dim]            status:[/] {status}  "
            f"[dim]{[Path(f).name for f in files]}[/]"
        )

    # ── Worker events ─────────────────────────────────────────────────────────

    def worker_start(self, task_id: str) -> None:
        _console.print(
            f"\n{'':>32}[yellow bold]🔧 Worker[/]  [dim]{task_id}[/]"
        )

    def worker_thinking(self, text: str) -> None:
        if not VERBOSE:
            return
        short = " ".join(text.split())[:260]
        _console.print(Panel(
            f"[italic dim]{short}[/]",
            title="[yellow]💭 thinking[/]",
            border_style="yellow",
            box=box.ROUNDED,
            width=self.W,
            padding=(0, 1),
        ), justify="right")

    def worker_tool(self, name: str, preview: str) -> None:
        if not VERBOSE:
            return
        _console.print(
            f"{'':>32}[yellow]🔧 ──▶[/]  [bold]{name}[/]  [dim]{preview[:60]}[/]"
        )

    def worker_write(self, path: str, lines: int) -> None:
        tag = "[dim][DRY RUN][/]" if DRY_RUN else "[green]✅[/]"
        _console.print(
            f"{'':>32}{tag}  [green]{path}[/]  [dim]{lines} lines[/]"
        )

    # ── Session end ───────────────────────────────────────────────────────────

    def session_done(self, elapsed: float, tasks: int, files: int) -> None:
        _console.print()
        _console.print(Rule(
            f"[bold green]✅  Done in {elapsed:.1f}s  ·  "
            f"{tasks} task{'s' if tasks != 1 else ''}  ·  "
            f"{files} file{'s' if files != 1 else ''}[/]",
            style="green",
        ))
        _console.print()


_ui = AgentUI()


# ─── Spinner helper ───────────────────────────────────────────────────────────

def _thinking_spinner(who: str):
    """Context manager: animated spinner while the LLM is processing."""
    color = "cyan" if who == "Orchestrator" else "yellow"
    icon  = "🤖"   if who == "Orchestrator" else "🔧"
    return _console.status(
        f"[{color}]{icon}  {who} is thinking…[/]",
        spinner="dots",
        spinner_style=color,
    )


# ─── Tool schemas ─────────────────────────────────────────────────────────────

ORCHESTRATOR_TOOLS: list[dict] = [
    {
        "name": "read_file",
        "description": "Read the contents of a file in the repository.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path relative to repo root"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "list_files",
        "description": "List files in a directory (non-recursive).",
        "input_schema": {
            "type": "object",
            "properties": {
                "directory": {"type": "string"},
            },
            "required": ["directory"],
        },
    },
    {
        "name": "delegate_to_worker",
        "description": "Delegate a coding task to WorkerAgent.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id":      {"type": "string"},
                "description":  {"type": "string"},
                "context":      {"type": "string"},
                "output_files": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "write_file",
        "description": "Write or overwrite a file in the repository.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path":    {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "mark_done",
        "description": "Signal that all development tasks are complete.",
        "input_schema": {
            "type": "object",
            "properties": {
                "summary":       {"type": "string"},
                "files_created": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["summary", "files_created"],
        },
    },
]

WORKER_TOOLS: list[dict] = [
    {
        "name": "write_code",
        "description": "Submit complete file content to the Orchestrator.",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path":   {"type": "string"},
                "content":     {"type": "string"},
                "explanation": {"type": "string"},
            },
            "required": ["file_path", "content"],
        },
    },
    {
        "name": "request_context",
        "description": "Ask the Orchestrator to supply additional file contents.",
        "input_schema": {
            "type": "object",
            "properties": {
                "paths":  {"type": "array", "items": {"type": "string"}},
                "reason": {"type": "string"},
            },
            "required": ["paths"],
        },
    },
]


# ─── File-system helpers ──────────────────────────────────────────────────────

def _read_file(path: str) -> str:
    full = REPO_ROOT / path
    if not full.exists():
        return f"ERROR: {path} not found"
    try:
        return full.read_text(encoding="utf-8")
    except Exception as exc:
        return f"ERROR reading {path}: {exc}"


def _list_files(directory: str) -> str:
    full = REPO_ROOT / directory
    if not full.exists():
        return f"ERROR: {directory} not found"
    lines = []
    for entry in sorted(full.iterdir()):
        tag = "DIR " if entry.is_dir() else "FILE"
        lines.append(f"{tag} {entry.relative_to(REPO_ROOT)}")
    return "\n".join(lines) if lines else "(empty)"


def _write_file(path: str, content: str) -> str:
    full = REPO_ROOT / path
    if DRY_RUN:
        return f"DRY RUN: {path}"
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content, encoding="utf-8")
    return f"written {path} ({len(content):,} chars)"


# ─── WorkerAgent ──────────────────────────────────────────────────────────────

@dataclass
class WorkerResult:
    task_id:     str
    files:       dict[str, str] = field(default_factory=dict)
    explanation: str = ""
    success:     bool = False


class WorkerAgent:
    """Receives a task + context and produces code files."""

    def __init__(self, client: anthropic.Anthropic) -> None:
        self.client = client

    def execute(
        self,
        task_id:      str,
        description:  str,
        context:      str,
        output_files: list[str],
    ) -> WorkerResult:
        _ui.worker_start(task_id)
        result   = WorkerResult(task_id=task_id)
        messages = [
            {
                "role": "user",
                "content": (
                    "You are a senior TypeScript/Python engineer implementing a feature.\n\n"
                    f"TASK:\n{description}\n\n"
                    f"CONTEXT:\n{context}\n\n"
                    f"Expected output files: {json.dumps(output_files)}\n\n"
                    "Use write_code for each file. Output complete, production-ready code. "
                    "Use request_context if you need to see additional files."
                ),
            }
        ]

        for _ in range(MAX_WORKER_STEPS):
            with _thinking_spinner("Worker"):
                resp = self.client.messages.create(
                    model=MODEL,
                    max_tokens=8192,
                    tools=WORKER_TOOLS,
                    messages=messages,
                )
            messages.append({"role": "assistant", "content": resp.content})

            for block in resp.content:
                if block.type == "text" and block.text.strip():
                    _ui.worker_thinking(block.text.strip())

            tool_results: list[dict] = []
            for block in resp.content:
                if block.type != "tool_use":
                    continue
                name = block.name
                inp  = block.input  # type: ignore[union-attr]

                if name == "write_code":
                    fpath   = inp["file_path"]
                    content = inp["content"]
                    lines   = content.count("\n")
                    _ui.worker_tool("write_code", fpath)
                    result.files[fpath] = content
                    result.explanation += f"\n{fpath}: {inp.get('explanation', '')}"
                    _write_file(fpath, content)
                    _ui.worker_write(fpath, lines)
                    tool_results.append({
                        "type":        "tool_result",
                        "tool_use_id": block.id,
                        "content":     f"written: {fpath}",
                    })

                elif name == "request_context":
                    paths = inp["paths"]
                    _ui.worker_tool("request_context", str(paths))
                    snippets = [f"--- {p} ---\n{_read_file(p)}" for p in paths]
                    tool_results.append({
                        "type":        "tool_result",
                        "tool_use_id": block.id,
                        "content":     "\n\n".join(snippets),
                    })

            if tool_results:
                messages.append({"role": "user", "content": tool_results})

            if resp.stop_reason == "end_turn":
                break

        result.success = bool(result.files)
        return result


# ─── OrchestratorAgent ────────────────────────────────────────────────────────

_SYSTEM = """
You are the Orchestrator for implementing the GoPro Scoreboard feature in a
React + TypeScript + Vite ping-pong ELO tracker.

Feature goal:
  GoPro RTSP → YOLOv8 → digit OCR → score → POST to /api/score (Vercel)

Files to implement:
  api/score.ts              — Vercel serverless endpoint
  scoreboard/scoreboard.py  — Runtime multi-agent tracker
  scoreboard/requirements.txt
  scoreboard/.env.example

Workflow:
  1. Read api/bulletins.ts, api/generate.ts, vercel.json, .env.example.
  2. Plan the four tasks above.
  3. Delegate each to WorkerAgent via delegate_to_worker.
  4. Call mark_done once all tasks complete.
"""


class OrchestratorAgent:
    def __init__(
        self,
        client:      anthropic.Anthropic,
        worker:      WorkerAgent,
        task_filter: Optional[str] = None,
    ) -> None:
        self.client      = client
        self.worker      = worker
        self.task_filter = task_filter
        self._messages:  list[dict] = []
        self._results:   dict[str, WorkerResult] = {}
        self._done       = False

    def _preview(self, inp: dict) -> str:
        key_order = ["path", "directory", "task_id", "file_path", "paths", "summary"]
        return next(
            (f"{k}={repr(inp[k])[:60]}" for k in key_order if k in inp),
            str(inp)[:80],
        )

    def _dispatch(self, name: str, inp: dict) -> str:
        if name == "read_file":
            result = _read_file(inp["path"])
            _ui.orch_result(f"{inp['path']}  ({len(result.splitlines())} lines)")
            return result

        if name == "list_files":
            result = _list_files(inp["directory"])
            _ui.orch_result(result[:120])
            return result

        if name == "write_file":
            path    = inp.get("path", "")
            content = inp.get("content", "")
            if not path or not content:
                return f"ERROR: write_file missing path or content"
            result = _write_file(path, content)
            _ui.orch_result(result)
            return result

        if name == "delegate_to_worker":
            tid = inp["task_id"]
            if self.task_filter and self.task_filter not in tid:
                return f"Skipped (filter: {self.task_filter})"
            _ui.delegate(tid)
            worker_result = self.worker.execute(
                task_id      = tid,
                description  = inp.get("description", tid),
                context      = inp.get("context", ""),
                output_files = inp.get("output_files", []),
            )
            self._results[tid] = worker_result
            _ui.delegate_result(tid, list(worker_result.files), worker_result.success)
            status = "OK" if worker_result.success else "FAILED"
            return (
                f"[{status}] {tid} | files: {list(worker_result.files)} | "
                f"{worker_result.explanation[:200]}"
            )

        if name == "mark_done":
            self._done = True
            return "acknowledged"

        return f"unknown tool: {name}"

    def run(self) -> dict[str, WorkerResult]:
        _ui.header()
        self._messages = [
            {
                "role": "user",
                "content": (
                    "Analyse the existing codebase, plan the GoPro Scoreboard tasks, "
                    "delegate each to WorkerAgent, then call mark_done."
                ),
            }
        ]

        for step in range(MAX_ORCHESTRATOR_STEPS):
            _ui.orch_step(step + 1, MAX_ORCHESTRATOR_STEPS)

            with _thinking_spinner("Orchestrator"):
                resp = self.client.messages.create(
                    model     = MODEL,
                    max_tokens= 4096,
                    system    = _SYSTEM,
                    tools     = ORCHESTRATOR_TOOLS,
                    messages  = self._messages,
                )
            self._messages.append({"role": "assistant", "content": resp.content})

            for block in resp.content:
                if block.type == "text" and block.text.strip():
                    _ui.orch_thinking(block.text.strip())

            tool_calls = [b for b in resp.content if b.type == "tool_use"]
            if not tool_calls and resp.stop_reason == "end_turn":
                break

            tool_results: list[dict] = []
            for block in tool_calls:
                _ui.orch_tool(block.name, self._preview(block.input))  # type: ignore[union-attr]
                output = self._dispatch(block.name, block.input)  # type: ignore[union-attr]
                tool_results.append({
                    "type":        "tool_result",
                    "tool_use_id": block.id,
                    "content":     output,
                })

            if tool_results:
                self._messages.append({"role": "user", "content": tool_results})

            if self._done:
                break

        return self._results


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    global VERBOSE, DRY_RUN

    parser = argparse.ArgumentParser(
        description="Multi-agent dev script for the GoPro Scoreboard feature"
    )
    parser.add_argument("--dry-run",  action="store_true", help="No files written")
    parser.add_argument("--task",     metavar="FILTER",    help="Run only matching task")
    parser.add_argument("--verbose",  "-v", action="store_true",
                        help="Show LLM thinking and tool details")
    args = parser.parse_args()

    VERBOSE = args.verbose
    DRY_RUN = args.dry_run

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        _console.print("[red]✗  Set ANTHROPIC_API_KEY in your environment.[/]")
        sys.exit(1)

    client       = anthropic.Anthropic(api_key=api_key)
    worker       = WorkerAgent(client)
    orchestrator = OrchestratorAgent(client, worker, task_filter=args.task)

    t0      = time.time()
    results = orchestrator.run()
    elapsed = time.time() - t0

    total_files = sum(len(r.files) for r in results.values())
    _ui.session_done(elapsed, len(results), total_files)


if __name__ == "__main__":
    main()
