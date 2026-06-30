# RTK Copilot Bootstrap

Repo-local bootstrap for GitHub Copilot RTK support. Copies `rtk init -g --copilot --no-patch` behavior into a target repo without touching global editor settings.

Source of truth (canonical): `C:\Personal_utilities\rtk\README.md`.

## Files

- `bootstrap-rtk-copilot.js` — Node script; spawns `rtk init -g --copilot --no-patch` in the target directory.
- `bootstrap-rtk-copilot.cmd` — Windows wrapper to invoke the script with the right Node.
- `.github/hooks/rtk-rewrite.json` — PreToolUse hook (managed).
- `.github/copilot-instructions.md` — RTK baseline instructions (managed).

## Usage

From this repo:

```bash
node tools/rtk-bootstrap/bootstrap-rtk-copilot.js
node tools/rtk-bootstrap/bootstrap-rtk-copilot.js ../other-repo
node tools/rtk-bootstrap/bootstrap-rtk-copilot.js ../other-repo --force
```

Or via the Windows wrapper:

```cmd
tools\rtk-bootstrap\bootstrap-rtk-copilot.cmd
tools\rtk-bootstrap\bootstrap-rtk-copilot.cmd ..\other-repo --force
```

Use `--force` to overwrite existing `.github/hooks/rtk-rewrite.json` or `.github/copilot-instructions.md`.