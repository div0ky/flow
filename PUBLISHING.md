# Publishing div-flow to npm

## Pre-publish Checklist

✅ Package name is configured (`@div0ky/flow`)
✅ CLI commands configured (`dflow` and `fl` alias)
✅ Package.json is configured correctly
✅ Bin entry point is set (`./src/cli.ts` with shebang `#!/usr/bin/env bun`)
✅ Files array includes only necessary files (`src/**/*.ts`)
✅ README.md is included
✅ Tests are passing (`bun test`)
✅ .npmignore excludes test files and development files

## Publishing Steps

### 1. Login to npm (if not already logged in)

```bash
npm login
```

You'll be prompted for:
- Username
- Password
- Email
- One-time password (if 2FA is enabled)

### 2. Verify you're logged in

```bash
npm whoami
```

### 3. Test the package locally (optional but recommended)

```bash
# Create a tarball to test
npm pack

# This creates div-flow-0.1.0.tgz
# You can test installing it locally:
npm install -g ./div-flow-0.1.0.tgz
```

### 4. Publish to npm

**For first-time publish:**

```bash
npm publish --access public
```

**For subsequent publishes (after version bump):**

```bash
# First, update version in package.json
# Then:
npm publish
```

### 5. Verify the publish

```bash
npm view @div0ky/flow
```

## Post-Publish

After publishing, users can install with:

```bash
npm install -g @div0ky/flow
```

The CLI commands are `dflow` and `fl` (alias).

## Updating the Package

1. Update version in `package.json`:
   ```json
   "version": "0.1.1"  // or "0.2.0", "1.0.0", etc.
   ```

2. Update CHANGELOG if you have one

3. Commit changes:
   ```bash
   git add package.json
   git commit -m "chore: bump version to 0.1.1"
   git tag v0.1.1
   ```

4. Publish:
   ```bash
   npm publish
   ```

## Important Notes

- The package requires Bun runtime (`engines.bun >= 1.0.0`)
- Users must have Bun installed to use this CLI tool
- The package includes TypeScript source files (no compilation needed for Bun)
- Make sure the repository URL in package.json matches your actual GitHub repo

