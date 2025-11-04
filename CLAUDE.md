# Claude Development Guide

This document contains important instructions for AI assistants (Claude) working on this codebase.

## Prerequisites - Always Check First! ⚠️

Before starting ANY task, always verify and set up the following:

### 1. Bun Installation

Check if Bun is installed:
```bash
bun --version
```

If not installed, install it globally:
```bash
npm install -g bun
```

### 2. Dependencies Installation

Always ensure dependencies are installed before running code or tests:
```bash
bun install
```

This will install all packages from `package.json` including:
- `effect` - The Effect library
- `@types/bun` - Bun TypeScript types
- `prettier` - Code formatter

## Running Tests

This project uses Bun's built-in test runner.

### Run all tests:
```bash
bun test
```

### Run specific test file:
```bash
bun test src/state-sync/state.test.ts
```

### Run with watch mode (if needed):
```bash
bun test --watch
```

**Expected output**: All tests should pass (currently 52 tests)

## Effect Documentation Reference

When working with Effect code or reviewing Effect usage, always reference the official Effect documentation:

**Effect Full Documentation for LLMs**: https://effect.website/llms-full.txt

This URL contains the complete Effect documentation optimized for AI consumption, including:
- Core concepts (Runtime, Effect type, Fiber-based concurrency)
- Best practices (error handling, service architecture, resource management)
- API reference (all Effect modules and their usage)
- Common patterns and examples

**When to fetch Effect docs**:
- Before reviewing or refactoring Effect code
- When implementing new Effect-based features
- When debugging Effect-related issues
- When uncertain about Effect patterns or APIs

### Quick fetch example:
```bash
curl https://effect.website/llms-full.txt
```

Or use the WebFetch tool in Claude to read and analyze the docs.

## Code Quality

### Format code before committing:
```bash
npx prettier --write .
```

### Check formatting:
```bash
npx prettier --check .
```

### TypeScript type checking:
```bash
tsc --noEmit
```

Note: You may see errors about 'bun-types' not found when running tsc directly. This is expected in the Bun environment. Use `bun test` to validate code instead.

## Project Structure

```
fp-with-ari/
├── src/
│   └── state-sync/          # Main state synchronization system
│       ├── types.ts          # Core types and error definitions
│       ├── state.ts          # State management and event application
│       ├── batching.ts       # Event batching system
│       ├── subscription.ts   # Subscription filtering
│       ├── pubsub.ts         # Main pub/sub system
│       ├── runtime.ts        # ManagedRuntime utilities
│       ├── index.ts          # Public API exports
│       └── *.test.ts         # Test files
├── main.ts                   # Example entry point
├── package.json
├── tsconfig.json
└── CLAUDE.md                 # This file
```

## Common Tasks

### Before starting any task:
1. ✅ Check Bun is installed (`bun --version`)
2. ✅ Install dependencies (`bun install`)
3. ✅ Review Effect docs if working with Effect code
4. ✅ Run tests to ensure baseline (`bun test`)

### After completing a task:
1. ✅ Run tests (`bun test`)
2. ✅ Format code (`npx prettier --write .`)
3. ✅ Commit with descriptive message
4. ✅ Push to the current branch

## Git Workflow

Current branch: `claude/review-effect-docs-011CUnH2Ltb4y3GLJk2Ry2NK`

### Committing changes:
```bash
git add -A
git status  # Review changes
git commit -m "Descriptive message"
git push
```

### Branch naming:
Feature branches should start with `claude/` prefix.

## Effect Best Practices (Quick Reference)

This project uses Effect extensively. Key patterns to follow:

1. **Explicit Error Types**: Always specify error types in Effect signatures
   ```typescript
   Effect.Effect<Success, Error, Requirements>
   ```

2. **Tagged Errors**: Use `Data.TaggedError` for error definitions
   ```typescript
   class MyError extends Data.TaggedError("MyError")<{ message: string }> {}
   ```

3. **Branded Types**: Use `Brand.refined` for runtime validation
   ```typescript
   Brand.refined<MyType>(validator, errorMessage)
   ```

4. **Config API**: Use Effect's Config for validated configuration
   ```typescript
   Config.number("VAR_NAME").pipe(Config.withDefault(42))
   ```

5. **Services**: Use `Effect.Service` for dependency injection
   ```typescript
   class MyService extends Effect.Service<MyService>()("MyService", {...}) {}
   ```

6. **ManagedRuntime**: Use for external framework integration
   ```typescript
   const runtime = ManagedRuntime.make(layer)
   ```

For complete guidance, always fetch: https://effect.website/llms-full.txt

## Troubleshooting

### "Cannot find package 'effect'"
```bash
bun install
```

### "bun: command not found"
```bash
npm install -g bun
```

### Tests failing after changes
```bash
# Make sure dependencies are up to date
bun install

# Run tests to see specific failures
bun test

# Check if code is properly formatted
npx prettier --check .
```

### Effect.cached causing stale data
Note: `Effect.cached` should be used carefully as it can cache stale values. Only use when cache invalidation is properly handled.

## Important Notes

- **Always run `bun install`** after pulling changes
- **Always run tests** before committing
- **Always format code** before committing
- **Reference Effect docs** when working with Effect code
- **Keep error types explicit** in all Effect signatures
- **Validate configuration** using Config API
- **Use ManagedRuntime** for external integrations

---

Last updated: 2025-11-04
Project uses: Effect v3.18.4, Bun v1.3.1, TypeScript, Prettier
