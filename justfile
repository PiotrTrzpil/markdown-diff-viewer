# Build the project
build:
    pnpm run build

# Build in watch mode
dev:
    pnpm run dev

# Run the CLI (pass args after --)
run *args:
    node dist/cli.js {{args}}

# Install dependencies
install:
    pnpm install

# Clean build output
clean:
    rm -rf dist

# Rebuild from scratch
rebuild: clean build

# Install globally via pnpm
link: build
    pnpm link --global

# Uninstall global link
unlink:
    pnpm unlink --global

# Run tests
test:
    pnpm test

# Run tests in watch mode
test-watch:
    npx vitest

# Demo: compare test fixtures
demo:
    node dist/cli.js test/fixtures/diverse-before.md test/fixtures/diverse-after.md
