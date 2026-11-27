# AGENTS.md instructions

<INSTRUCTIONS>
# Global agent guidelines

These apply in every repository. A repository's own AGENTS.md adds to or overrides them.

## Everywhere
- Don't add backwards-compatibility layers or adapters unless asked. If one seems necessary, stop and ask; usually it is not needed.
- Working documentation, debugging logs and reports go in docmgr tickets under `ttmp/YYYY/MM/DD/<TICKET>--<slug>/`.
- Run servers and other long-running processes in tmux, so they are easy to inspect (`capture-pane`) and to kill. Test TUIs the same way. Batch commands when using `send-keys`.
- Free a port with `lsof-who -p $PORT -k`.
- Ask before reading anything from the environment (variables, secrets).

## Go repositories (a `go.mod` at the root)
- Build `go build ./...`, test `go test ./...`, one test `go test ./pkg/path -run TestName`, generate `go generate ./...`, lint `golangci-lint run -v` or `make lint`, format `go fmt ./...`.
- Run a binary with `go run ./cmd/<name>` instead of building it first.
- Layout: `cmd/` for entry points, `pkg/` for library code by domain, `examples/`, `doc/`. One top-level `go.mod`.
- Command-line applications use glazed (see the glazed skill). Use glazed fields and sections instead of `os.Getenv`.
- Pass a `context.Context` where appropriate, start goroutines with `errgroup`, wrap errors with `github.com/pkg/errors`.
- Check interface implementations with `var _ Interface = &Foo{}`.
- Name a package `defaults`, not `default` (reserved).
- Import embed as `_ "embed"` for `go:embed`.
- Code behind a build tag must also compile without the tag.
- New experiments and apps get zerolog logging and a `--log-level` flag.
- For the Gemini/genai APIs use `google.golang.org/genai`.

## Web front ends
- TypeScript, pnpm, React, Redux Toolkit with RTK Query.
- When a Go server embeds the front end, serve it with `go:embed` under `/static/`, never under functional paths such as `/admin/`.
</INSTRUCTIONS><environment_context>
  <cwd>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-sh-irwb-023-a</cwd>
  <shell>zsh</shell>
  <current_date>2026-11-26</current_date>
  <timezone>America/New_York</timezone>
  <filesystem><workspace_roots><root>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-sh-irwb-023-a</root><root>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git</root></workspace_roots><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry><entry access="write"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-sh-irwb-023-a</path></entry><entry access="write"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git</path></entry><entry access="write"><special>:slash_tmp</special></entry><entry access="write"><special>:tmpdir</special></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-sh-irwb-023-a/.git</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/.git</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-sh-irwb-023-a/.agents</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/.agents</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-sh-irwb-023-a/.codex</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/.codex</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-sh-irwb-023-a/.aws</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/.aws</path></entry></file_system></permission_profile></filesystem>
</environment_context>