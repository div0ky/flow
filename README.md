# flow

A CLI tool for managing git workflows with AI-powered commit messages and PR generation.

## Requirements

- **Bun** runtime (>=1.0.0) - This package requires Bun to run

## Installation

```bash
npm install -g @div0ky/flow
```

Or install locally:

```bash
npm install @div0ky/flow
```

After installation, use the `dflow` command (or `fl` as a shorter alias):

```bash
dflow --help
# or
fl --help
```

## Setup

Before using flow, you need to configure your API keys:

```bash
dflow config init
# or
fl config init
```

This will guide you through setting up:
- Google AI API key (for AI-powered commit messages and PR descriptions)
- GitHub token (for creating pull requests)
- Linear API key (optional, for Linear issue integration)

You can also set individual config values:

```bash
dflow config set googleAiKey <your-key>
dflow config set githubToken <your-token>
dflow config set linearApiKey <your-key>
```

View your configuration:

```bash
dflow config list
```

## Usage

### Commits

Generate AI-powered commit messages:

```bash
dflow commit
# or
fl commit
```

### Feature Workflow

Start a new feature branch:

```bash
dflow feature start
# or
fl feature start
```

Finish a feature (create PR to develop):

```bash
dflow feature finish
# or
fl feature finish
```

### Release Workflow

Start a new release branch:

```bash
dflow release start
```

Stage a release for testing:

```bash
dflow release stage
```

Finish a release (create PR to main):

```bash
dflow release finish
```

### Hotfix Workflow

Start a new hotfix branch:

```bash
dflow hotfix start
```

Finish a hotfix (create PRs to main and develop):

```bash
dflow hotfix finish
```

## Configuration

Configuration is stored in `~/.div-flow/config.json` (global) or `.div-flow.json` (project-local). Project-local config takes precedence over global config.

Environment variables are also supported as a fallback:
- `GOOGLE_AI_KEY` or `GOOGLE_AI_KEY`
- `GH_TOKEN` or `GITHUB_TOKEN`
- `LINEAR_API_KEY`

## License

MIT
