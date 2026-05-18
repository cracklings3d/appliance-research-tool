# Local data ownership for MVP users

This page is for users who inspect or manually edit the Appliance Research Tool's local app-data files. It explains which files start shipped with the app, which files become user-owned in the active app profile, and how to reason about the local schema, **Option**, and comparison-preset files used by the MVP.

All paths on this page are canonical path conventions rooted at `app.getPath('userData')` for the active app profile. They are not OS-specific absolute paths, and this page intentionally does not document resolved support-path locations for Windows, macOS, or Linux.

## How shipped schema files become local user-owned files

Shipped schema files start in the repository `schemas/` directory.

On first run, the app checks the active app profile for local schema files. If a schema file is missing there, the app copies the shipped schema into the active app profile.

After that bootstrap step, the local schema files in the active app profile become the editable source of truth for the app. If you want to inspect or manually edit schema JSON for MVP use, edit the local app-profile schema files rather than the shipped repository copies.

## Canonical app-profile path conventions

Treat the active app profile as rooted at:

```text
<app.getPath('userData')>/
```

Within that root, the canonical local directories and files are:

```text
/schemas/
/options/washer.options.json
/options/dryer.options.json
/options/laundry-set.options.json
/comparison-presets/washer.comparison-presets.json
/comparison-presets/dryer.comparison-presets.json
/comparison-presets/laundry-set.comparison-presets.json
```

These are canonical relative path conventions for the active app profile, not literal OS-specific absolute paths.

## What each local data area owns

- `schemas/` stores the local schema definitions for each **Appliance**. In MVP, these files are user-editable after first-run bootstrap.
- `options/*.options.json` stores persisted local **Option** data per **Appliance**.
- `comparison-presets/*.comparison-presets.json` stores user-owned local comparison preferences per **Appliance**.

Comparison presets are not part of the shipped schema files. They are local user preferences kept separately inside the active app profile.

## Custom Dimensions in MVP

In MVP, users add custom **Dimensions** by editing local schema JSON outside the app.

In-app schema editing is out of scope for MVP.

## Safe migration boundary for local data

The app only guarantees the currently accepted minimum safe migration behavior for local schema and **Option** data:

- unchanged matching stored fields are preserved by key
- newly added optional **Dimensions** do not get invented values
- obsolete stored fields may be dropped when safe
- unsafe schema or data mismatches are not silently repaired; the app surfaces warnings or failures instead

This page does not promise broader automatic repair, troubleshooting flows, or migration behavior beyond those points.

## Missing-Dimension comparison preset behavior

If a saved comparison preset references a missing **Dimension**, the preset still remains loadable.

For effective use, the missing **Dimension** is ignored and the app shows a warning so you know the preset needs attention.
