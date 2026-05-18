# Windows MVP Build Verification

## Purpose and scope

This checklist verifies the MVP Windows build and packaging path only.

It is maintainer/reviewer guidance for issue #28, not end-user documentation.

## Prerequisites and environment assumptions

- Run all commands from the repository root on Windows.
- This checklist assumes project dependencies are already installed with `npm install`.
- Use the existing scripts defined in `package.json`; no extra tooling is required.
- Treat verification as failed if stale outputs make it unclear whether the current command run produced the observed artifacts. When in doubt, remove existing `dist/` and `release/` contents before rerunning the relevant command.

## `npm run build` pass/fail steps

Command:

```bash
npm run build
```

Pass when:

- the command exits successfully
- `dist/main/` exists
- `dist/preload/` exists
- `dist/renderer/index.html` exists

Fail when:

- the command exits non-zero
- `dist/main/` is absent
- `dist/preload/` is absent
- `dist/renderer/index.html` is absent

## `npm run electron:build` pass/fail steps

Command:

```bash
npm run electron:build
```

Verification depth for issue #28 is artifact presence only. Packaged-binary smoke launch is not required.

Pass when:

- the command exits successfully
- a Windows NSIS installer `.exe` is produced directly under `release/`

Fail when:

- the command exits non-zero
- no Windows NSIS installer `.exe` exists directly under `release/`

## Artifact inspection notes

- For this issue, the required packaged Windows artifact is the NSIS installer executable in `release/`.
- Supporting metadata files, unpacked directories, and other incidental outputs do not count as the packaged Windows artifact for this checklist.
- Keep inspection limited to build/package output verification; do not broaden this checklist into product-feature QA.
