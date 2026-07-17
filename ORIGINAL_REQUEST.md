# Original User Request

## Initial Request — 2026-07-13T09:20:12Z

Perform a comprehensive code review of the Guardians codebase (/Users/rivu/guardians/guardians-app) to identify TypeScript compiler errors, architectural rule violations, and logical bugs, then generate a detailed remediation plan.

Working directory: /Users/rivu/guardians/guardians-app
Integrity mode: development

## Requirements

### R1. Compiler & Type-checking Verification

Execute `npm run typecheck` and identify all TypeScript compiler errors, detailing their locations and root causes.

### R2. Architectural Rules Alignment

Audit the codebase against the workspace conventions defined in [AGENTS.md](file:///Users/rivu/guardians/guardians-app/AGENTS.md), specifically:

- Verification that custom components use `@/components/ui` barrel imports and design tokens in `src/theme`.
- Verification that sensitive DB writes happen ONLY via `supabase/migrations/0002_functions.sql` RPCs, not client-side writes.
- Verification that maps are imported from `@/components/PlatformMap` rather than `react-native-maps` directly.
- Verification that native dialogs use `@/lib/dialog` (`confirmAsync`, `notify`, `choosePhotoSource`) rather than React Native's `Alert`.
- Verification that Expo SDK 56 configurations do not contain deprecated `app.json` fields (`splash`, `newArchEnabled`, `android.edgeToEdgeEnabled`).

### R3. Logical Bugs & Code Quality Check

Identify potential logic bugs, edge cases, crashes, and missing error-handling structures in the core functionality (map interactions, Supabase client code, React Hook Form setup).

### R4. Remediation Plan Creation

Generate a detailed report `code_review_report.md` outlining each issue, its severity (High/Medium/Low), location, and step-by-step proposed fixes.

## Acceptance Criteria

### Audit Quality & Reporting

- [ ] A markdown report `code_review_report.md` is generated in the workspace root.
- [ ] Every error returned by `npm run typecheck` is documented with a clear explanation of how to resolve it.
- [ ] At least three codebase files are manually audited for compliance with each architectural guideline in [AGENTS.md](file:///Users/rivu/guardians/guardians-app/AGENTS.md), detailing any violations or confirming compliance.
- [ ] Each reported bug includes a code snippet or detailed path/line reference and a concrete step-by-step fix.
