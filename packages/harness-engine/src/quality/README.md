# Stage 6B quality modules

These modules provide deterministic, read-only mechanical governance for plans, roles, audits, Skills, and dual-host Plugin packages. They do not choose product direction, assess aesthetics, select models, or decide whether a Skill is worth using.

## Public module functions

- `lint.ts`: `validatePlanQuality` / `lintPlan` checks Markdown frontmatter, the tests/implementation/verification TDD triple, and temporary markers.
- `roles.ts`: `validateRoleMap` / `checkRoles` checks role identity, allowed hosts, source digests, duplicate roles, and exact load order.
- `audit.ts`: `auditPlanFiles` / `runAudit` checks relative containment, duplicate paths, required plan scaffold files, and delegates secret/supply-chain scanning.
- `secret-supply-chain.ts`: `scanSecretsAndSupplyChain` / `scanSecrets` detects credential-shaped strings and unsafe remote execution/package patterns without returning matched values.
- `plugins.ts`: `validatePluginPackage` / `validatePlugin` checks matching Claude and Codex manifests, portable `./skills/` layout, Skill frontmatter, duplicate Skill names, and absolute references. `validateSkillAuthoring` checks one Skill independently.

Every evaluation carries `pass`, `invalid`, or `unknown`, typed findings with severity/evidence/recovery, violation codes, and `Known`/`Unknown` knowledge. Absolute paths are reduced to `<absolute>/<basename>` and findings never contain matched secret text. Missing or unavailable source evidence remains `unknown`; no validator fabricates a successful fallback.

The modules are intentionally not exported from `src/index.ts` yet. A later composition root should expose these contracts and route CLI commands without changing the existing Stage 5 root or shared ports.
