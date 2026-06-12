# PROGRAMS

PROGRAMS is a macOS-first Electron desktop app for AI-assisted coding with:

- Codex plan-first updates
- compact system-health and Claude/Codex usage indicators
- local-first project management
- local run / kill / open controls
- a user-facing update history

## Setup

1. Install dependencies:

```bash
cd /Users/kc/Desktop/PROGRAMS && npm install
```

2. Make sure these user prerequisites are already available on the machine:

- Codex desktop app or CLI installed
- Git installed
- network access to Codex services

3. Start the app:

```bash
cd /Users/kc/Desktop/PROGRAMS && npm run dev
```

Electron dev startup expects the main-process bundle at `out/main/index.js`. If the Electron Vite output path changes later, update `package.json` `main` to match it.

## First Run

On first launch, PROGRAMS opens a guided setup screen before the homepage. It checks:

- Codex installed
- Git installed
- Codex signed in

If something is missing, PROGRAMS shows a clear action button and re-checks it without making the user restart the app.

## Credentials

PROGRAMS does not need an OpenAI API key for Codex.

It uses the locally installed Codex runtime and its saved ChatGPT/Codex login flow. Each user signs in once through the app and Codex keeps that login persisted.

## Verification

- `npm run typecheck`
- `npm run build`

## Package As A Mac App

Build a clickable `.app` bundle from the current source:

```bash
cd /Users/kc/Desktop/PROGRAMS && npm run package:mac
```

That outputs a stable app bundle at `dist/mac-arm64/PROGRAMS.app` on Apple Silicon Macs. If you keep that app in the Dock, rebuilding with `npm run package:mac` replaces it in place with your latest UI and backend changes.

Packaging does not lock the project. It is just a snapshot build of the current code. Keep editing the PROGRAMS source normally; when you want the clickable app refreshed, run the packaging command again.
