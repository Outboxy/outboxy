# Contributing to Outboxy

Thank you for contributing. This document covers branch conventions, the pull request process, versioning with Changesets, and how to add a new package.

## Getting Started

1. Fork the repository and clone your fork.
2. Follow the setup steps in [DEVELOPMENT.md](DEVELOPMENT.md).
3. Create a feature branch from `main`.

## Branch and Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages:

```
feat(sdk): add retry option to OutboxyClient
fix(worker): prevent duplicate outbox event processing on restart
chore(deps): update fastify to 5.x
docs: update quick start guide
```

Common prefixes: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`.

Include a scope in parentheses when the change targets a specific package — for example, `sdk`, `worker`, or `api`.

## Pull Request Process

1. Verify all checks pass locally before opening a PR:

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm build
   pnpm test
   ```

   The pre-push hook runs these checks automatically.

2. Open a PR against `main` and fill out the PR template (`.github/pull_request_template.md`). The template asks for:
   - A description of changes
   - Type of change (bug fix, feature, breaking change, etc.)
   - Related issues
   - A testing checklist

3. CI runs lint, typecheck, build, unit tests, integration tests, and Docker integration tests on every PR.

4. At least one review approval is required before merging.

## Git Hooks

The repository uses Husky for git hooks:

- **pre-commit**: Runs `lint-staged`, which applies ESLint with auto-fix and Prettier to staged `.ts` and `.tsx` files, and Prettier to staged `.js`, `.json`, `.md`, `.yaml`, and `.yml` files.
- **pre-push**: Validates the lockfile is current, then runs typecheck, lint, and build across all packages.

## Changeset Workflow

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and changelogs.

### When to Add a Changeset

Add a changeset whenever you modify source code in a publishable package: `sdk`, `sdk-nestjs`, `dialect-core`, `dialect-postgres`, `dialect-mysql`, or `schema`. The `pre-publish-check` CI workflow fails if a publishable package's source code changes without an accompanying changeset.

### How to Add a Changeset

The following command prompts you to select the affected packages and the semver bump type (patch, minor, or major), then creates a markdown file in `.changeset/` describing the change. Commit this file with your PR:

```bash
pnpm changeset
```

### Release Process

When changesets are merged to `main`, the release workflow either:

- Opens a "Version Packages" PR that bumps versions and updates changelogs, or
- Publishes to npm if the version PR was already merged.

Changelogs are generated using `@changesets/changelog-github`.

## Adding a New Package

1. Create the directory under `packages/<name>/`.
2. Add a `package.json` with `"name": "@outboxy/<name>"` and the standard scripts (`build`, `typecheck`, `clean`).
3. Add a `tsconfig.json` that mirrors the root TypeScript configuration (ES2022, NodeNext, strict mode).
4. Add a `tsconfig.build.json` for the production build.
5. The package is automatically included in the workspace via the `packages/*` glob in `pnpm-workspace.yaml`.
6. Run `pnpm install` from the root to link the new package.
7. If the package should be published to npm, add a `"files"` array and set `"publishConfig": { "access": "public" }`. Otherwise, set `"private": true`.

## Code Style

- TypeScript with strict mode — no `any` types.
- Zod for runtime validation.
- ES modules only (no CommonJS `require`).
- No raw SQL in the SDK layer (enforced by a custom ESLint rule).
- See `eslint.config.js` at the repo root for the full rule set.
