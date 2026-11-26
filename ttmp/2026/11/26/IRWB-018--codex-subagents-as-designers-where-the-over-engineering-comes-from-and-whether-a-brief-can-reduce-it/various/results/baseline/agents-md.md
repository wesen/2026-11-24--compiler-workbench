# AGENTS.md instructions

<INSTRUCTIONS>
# Agent Guidelines for go-go-golems go projects

## Build Commands

- Run a binary in XXX/YYY/FOOO: `go run ./XXX/YYY/FOOO` . Use this instead of build + ./XXX.
- Build: `go build ./...`
- Test: `go test ./...`
- Run single test: `go test ./pkg/path/to/package -run TestName`
- Generate: `go generate ./...`
- Lint: `golangci-lint run -v` or `make lint`
- Format: `go fmt ./...`

IMPORTANT: To run a server and do some interaction with it, use tmux, this makes it very easy to kill a server.
Use capture-pane to read the output.

## Project Structure

- `cmd/`: CLI commands and entry points
- `pkg/`: Library code organized by domain
- `examples/`: Example configurations and usage
- `doc/`: Documentation
- `ttmp/YYYY-MM-DD/`: this is where all temporary documentation as well as debugging logs and other reports go

<runningProcessesGuidelines>
- When testing TUIs, use tmux and capture-pane to interact with the UI.
- When using tmux, try to batch as many commands as possible when using send-keys.
- When running long-running processes (servers, etc...), use tmux to more easily interact and kill them.
- Kill a process using port $PORT: `lsof-who -p $PORT -k`. When building a web server, ALWAYS use this command to kill the process.
</runningProcessesGuidelines>

<goGuidelines>
- When implementing go interfaces, use the var _ Interface = &Foo{} to make sure the interface is always implemented correctly.
- When building web applications, use bootstrap CSS unless otherwise indicated.
- Always use a context argument when appropriate.
- Use glazed for command-line applications (see skill)
- Use the "defaults" package name, instead of "default" package name, as it's reserved in go.
- Use github.com/pkg/errors for wrapping errors.
- When starting goroutines, use errgroup.

- Only use the toplevel go.mod, don't create new ones.
- When writing a new experiment / app, add zerolog logging to help debug and figure out how it works, add --log-level flag to set the log level.
- When using go:embed, import embed as `_ "embed"`
- When using build tagged features, make sure the software compiles without the tag as well
- try to never use Getenv and use glazed fields and sections instead
- if you do read stuff from the environment, ask me / notify me beforehand
</goGuidelines>

<libraryGuidelines>
- when interfacing with the google gemini/genai APIs, use the new https://pkg.go.dev/google.golang.org/genai package
</libraryGuidelines>

<webGuidelines>
- Use pnpm, react, redux and rtk-query. Use typescript.
- Use bootstrap for styling (unless otherwise specified)
- Use go:embed to serve static files.
- Always serve static files under /static/ URL paths, never directly under functional paths like /admin/
</webGuidelines>

<generalGuidelines>
Don't add backwards compatibility layers or adapters unless explicitly asked. If you think there is a need for a backwards compatibility or adapting to an existing interface, STOP AND ASK ME IF THAT IS NECESSARY. Usually, I don't need backwards compatibility.
</generalGuidelines>
</INSTRUCTIONS><environment_context>
  <cwd>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-012</cwd>
  <shell>zsh</shell>
  <current_date>2026-11-26</current_date>
  <timezone>America/New_York</timezone>
  <filesystem><workspace_roots><root>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-012</root><root>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git</root></workspace_roots><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry><entry access="write"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-012</path></entry><entry access="write"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git</path></entry><entry access="write"><special>:slash_tmp</special></entry><entry access="write"><special>:tmpdir</special></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-012/.git</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/.git</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-012/.agents</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/.agents</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-012/.codex</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/.codex</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-012/.aws</path></entry><entry access="read"><path>/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/.aws</path></entry></file_system></permission_profile></filesystem>
</environment_context>