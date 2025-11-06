# div-flow

A CLI tool for managing git workflows with AI-powered commit messages and PR generation.

## Requirements

- **Bun** runtime (>=1.0.0) - This package requires Bun to run

## Installation

```bash
npm install -g div-flow
```

Or install locally:

```bash
npm install div-flow
```

## Setup

Before using div-flow, you need to configure your API keys:

```bash
div-flow config init
```

This will guide you through setting up:
- Google AI API key (for AI-powered commit messages and PR descriptions)
- GitHub token (for creating pull requests)
- Linear API key (optional, for Linear issue integration)

You can also set individual config values:

```bash
div-flow config set googleAiKey <your-key>
div-flow config set githubToken <your-token>
div-flow config set linearApiKey <your-key>
```

View your configuration:

```bash
div-flow config list
```

## Usage

### Commits

Generate AI-powered commit messages:

```bash
div-flow commit
```

### Feature Workflow

Start a new feature branch:

```bash
div-flow feature start
```

Finish a feature (create PR to develop):

```bash
div-flow feature finish
```

### Release Workflow

Start a new release branch:

```bash
div-flow release start
```

Stage a release for testing:

```bash
div-flow release stage
```

Finish a release (create PR to main):

```bash
div-flow release finish
```

### Hotfix Workflow

Start a new hotfix branch:

```bash
div-flow hotfix start
```

Finish a hotfix (create PRs to main and develop):

```bash
div-flow hotfix finish
```

## Configuration

Configuration is stored in `~/.div-flow/config.json` (global) or `.div-flow.json` (project-local). Project-local config takes precedence over global config.

Environment variables are also supported as a fallback:
- `GOOGLE_AI_KEY` or `GOOGLE_AI_KEY`
- `GH_TOKEN` or `GITHUB_TOKEN`
- `LINEAR_API_KEY`

## License

MIT
