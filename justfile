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
