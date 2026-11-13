#!/usr/bin/env python3
"""Where a Claude Code session's main context went. Read-only.

Usage: python3 -I scripts/session-context.py <session.jsonl>

Reports, for the main thread only (subagent transcripts are separate files):
- context size over time (input + cache read + cache creation on each assistant call);
- tool-result volume by tool, and by command for Bash;
- subagent reports handed back to the main thread, by agent type;
- the main thread's own output (agent prompts, Bash commands, file writes).
Sizes are characters; tokens are roughly characters / 4 (dense text such as JSON or paths runs higher).
"""
import json
import re
import sys
from collections import defaultdict


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(text_of(c.get("text", c.get("content", ""))) if isinstance(c, dict) else str(c) for c in content)
    return ""


def bash_key(cmd):
    cmd = cmd.strip()
    m = re.match(r"(?:cd [^&;]+&&\s*)?((?:cairn|git|npm|node|cat|sed|grep|python3)(?:\s+[a-z-]+)?)", cmd)
    return m.group(1) if m else cmd.split()[0] if cmd else "?"


def main(path):
    uses, results = {}, defaultdict(lambda: [0, 0])
    bash, handbacks, launches = defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0]), {}
    out = defaultdict(int)
    ctx, seen, agent_kind, pending = [], set(), {}, []
    for line in open(path, encoding="utf-8"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("isSidechain"):
            continue
        msg = e.get("message") or {}
        if e.get("type") == "assistant":
            u, mid = msg.get("usage") or {}, msg.get("id")
            if u and mid not in seen:
                seen.add(mid)
                ctx.append((e.get("timestamp", "")[11:16], u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)))
            for c in msg.get("content") or []:
                if c.get("type") == "tool_use":
                    uses[c["id"]] = c
                    inp = c.get("input", {})
                    out[c["name"]] += len(json.dumps(inp))
                    if c["name"] == "Agent":
                        launches[c["id"]] = inp.get("subagent_type", "general-purpose")
                elif c.get("type") == "text":
                    out["(text)"] += len(c.get("text", ""))
        elif e.get("type") == "user":
            content = msg.get("content")
            if isinstance(content, str) and "Subagent hand-back" in content:
                sender = re.search(r'agent-message from="(\w+)"', content)
                k = agent_kind.get(sender.group(1) if sender else "", "(unknown agent)")
                handbacks[k][0] += 1
                handbacks[k][1] += len(content)
                continue
            for c in content if isinstance(content, list) else []:
                if isinstance(c, dict) and c.get("type") == "tool_result":
                    use = uses.get(c.get("tool_use_id"), {})
                    name, size = use.get("name", "?"), len(text_of(c.get("content")))
                    if name == "Agent":
                        aid = re.search(r"agentId: (\w+)", text_of(c.get("content")))
                        if aid:
                            agent_kind[aid.group(1)] = launches.get(c.get("tool_use_id"), "?")
                    results[name][0] += 1
                    results[name][1] += size
                    if name == "Bash":
                        k = bash_key(use.get("input", {}).get("command", ""))
                        bash[k][0] += 1
                        bash[k][1] += size

    def table(title, rows):
        print(f"\n{title}")
        for k, (n, size) in sorted(rows.items(), key=lambda r: -r[1][1])[:15]:
            print(f"  {k:<40} {n:>4}  {size:>9,} chars  ~{size // 4:>7,} tok")

    if ctx:
        print(f"Context: {ctx[0][1]:,} -> {ctx[-1][1]:,} tokens over {len(ctx)} calls ({ctx[0][0]} to {ctx[-1][0]})")
        step = max(1, len(ctx) // 10)
        print("  " + "  ".join(f"{t} {v // 1000}K" for t, v in ctx[::step]))
    table("Tool results by tool", results)
    table("Bash results by command", bash)
    table("Subagent reports handed back", handbacks)
    agents = defaultdict(int)
    for k in launches.values():
        agents[k] += 1
    print("\nAgents launched: " + ", ".join(f"{k} {n}" for k, n in sorted(agents.items(), key=lambda r: -r[1])))
    print("\nMain thread output (tool inputs and text), chars:")
    for k, v in sorted(out.items(), key=lambda r: -r[1])[:10]:
        print(f"  {k:<40} {v:>9,}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
