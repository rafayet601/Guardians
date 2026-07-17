# Project: Guardians Codebase Audit & Remediation

## Architecture
This project is a comprehensive code review of the Guardians React Native / Expo application to find and document:
1. TypeScript compiler and type-checking issues.
2. Architectural violations of the conventions established in `AGENTS.md`.
3. Logical bugs and code quality flaws in core areas (Map, Supabase, Forms, etc.).
The output will be a comprehensive `code_review_report.md` in the workspace root.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | TypeScript Compiler Audit | Identify all compiler errors via `npm run typecheck` | None | DONE |
| 2 | Architectural Rules Audit | Verify barrel imports, theme tokens, DB writes, map usage, dialog usage, and Expo SDK 56 config | None | DONE |
| 3 | Logical Bugs Audit | Check Map interactions, Supabase client code, React Hook Form setup | None | DONE |
| 4 | Remediation Plan Generation | Compile findings into `code_review_report.md` | M1, M2, M3 | DONE |

## Interface Contracts
### Auditing ↔ Remediation Plan
- Inputs: stdout of typecheck command, manually audited codebase files, configuration files.
- Outputs: `code_review_report.md` specifying each issue's severity, location, description, and concrete step-by-step fix.
