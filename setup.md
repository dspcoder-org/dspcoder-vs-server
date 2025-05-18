# code-server: VS Code in the Browser

[![GitHub Discussions](https://img.shields.io/badge/%20GitHub-%20Discussions-gray.svg?longCache=true&logo=github&colorB=purple)](https://github.com/coder/code-server/discussions)
[![Join us on Slack](https://img.shields.io/badge/join-us%20on%20slack-gray.svg?longCache=true&logo=slack&colorB=brightgreen)](https://coder.com/community)
[![Twitter Follow](https://img.shields.io/twitter/follow/CoderHQ?label=%40CoderHQ&style=social)](https://twitter.com/coderhq)
[![codecov](https://codecov.io/gh/coder/code-server/branch/main/graph/badge.svg?token=5iM9farjnC)](https://codecov.io/gh/coder/code-server)

**code-server** lets you run [VS Code](https://github.com/Microsoft/vscode) on any machine anywhere and access it through the browser.

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Key Features](#key-features)
- [Directory Structure](#directory-structure)
- [Development Workflow](#development-workflow)
- [Building and Running](#building-and-running)
- [Authentication and Security](#authentication-and-security)
- [Configuration](#configuration)
- [Customizations](#customizations)
- [Testing](#testing)
- [Packaging and Deployment](#packaging-and-deployment)
- [Documentation](#documentation)
- [License](#license)

## Project Overview

code-server is a service that enables running Visual Studio Code on a remote server accessible through a web browser. This approach offers several advantages:

- Consistent development environment across different devices
- Leverage more powerful hardware for resource-intensive tasks
- Preserve battery life on portable devices
- Access your development environment from anywhere
- Centralized management for teams

## Architecture

code-server consists of several major components:

1. **Node.js Backend Server**: Handles authentication, proxying, and integration with VS Code
   - Express-based HTTP server with WebSocket support
   - Custom routing for VS Code integration
   - Proxy server for accessing other services on the remote machine

2. **Modified VS Code**: Core IDE functionality
   - Maintained as a Git submodule with patches applied
   - Adapted to run in a browser environment
   - Extended with code-server-specific features

3. **Browser Client**: The frontend that users interact with
   - Leverages VS Code's web capabilities
   - Service worker for enhanced offline support
   - Custom authentication UI

## Key Features

- **Full VS Code Experience**: Nearly all VS Code features are supported
- **Authentication**: Password-based or None (configurable)
- **HTTPS Support**: Built-in TLS with self-signed certificates
- **Port Forwarding**: Access services running on the remote machine
- **Extension Support**: Install and use VS Code extensions
- **Custom Marketplace**: Support for alternative extension marketplaces
- **Multi-platform**: Linux, macOS, Windows on x86 and ARM architectures
- **Container Ready**: Official Docker images and deployment options
- **Configurable**: Via CLI flags or config file

## Directory Structure

```
code-server/
├── ci/                   # Continuous integration and build scripts
│   ├── build/            # Build scripts for code-server and packages
│   ├── dev/              # Development-related utilities
│   ├── helm-chart/       # Kubernetes Helm chart
│   ├── release-image/    # Docker image build files
│   └── steps/            # CI pipeline steps
├── docs/                 # Documentation
├── lib/                  # External dependencies
│   └── vscode/           # VS Code source (submodule)
├── patches/              # Patch files for VS Code modifications
├── src/                  # Source code
│   ├── browser/          # Browser-specific code and assets
│   ├── common/           # Shared utilities
│   └── node/             # Node.js server code
│       ├── routes/       # Express routes
│       └── ...           # Core server modules
├── test/                 # Test suite
│   ├── e2e/              # End-to-end tests
│   ├── integration/      # Integration tests
│   └── unit/             # Unit tests
└── typings/              # TypeScript type definitions
```

## Development Workflow

The development workflow in code-server involves:

1. **VS Code Integration**: The VS Code codebase is included as a Git submodule and modified with patches.
2. **Node.js Server**: A custom Express server handles HTTP and WebSocket requests.
3. **Patch Management**: Modifications to VS Code are managed through quilt patch files.
4. **Build Process**: TypeScript compilation for the server and packaging the client.

## Building and Running

### Building from Source

```bash
# Clone the repository
git clone https://github.com/coder/code-server.git
cd code-server

# Initialize submodule
git submodule update --init


# apply patches
quilt push -a

# Install dependencies
npm install

# Build code-server
npm run build


node . .

build package. js
VERSION=${VERSION:-$(jq -r .version < ./package.json)}
OS=${OS:-$(uname -s | tr '[:upper:]' '[:lower:]')}
ARCH=${ARCH:-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')}


# Start in development mode
npm run watch
```

### Running

```bash
# Start code-server
code-server [path]

# With custom options
code-server --bind-addr 0.0.0.0:8080 --auth password /path/to/project
```

## Authentication and Security

code-server supports two authentication modes:

1. **Password Authentication** (default): Requires a password to access the server
2. **None**: No authentication, suitable for already secured environments

Security recommendations:

- Always use authentication unless in secure environments
- Enable HTTPS with valid certificates
- Consider using a reverse proxy like Caddy or NGINX
- Implement rate limiting (code-server has built-in rate limiting for authentication attempts)

## Configuration

code-server can be configured through:

1. **Command-line arguments**
2. **Configuration file** (default: `~/.config/code-server/config.yaml`)
3. **Environment variables**

Key configuration options include:

- `--bind-addr`: Address to bind to (default: 127.0.0.1:8080)
- `--auth`: Authentication type (password/none)
- `--password`: Password for authentication
- `--cert`: Path to TLS certificate or set to true to generate one
- `--cert-key`: Path to TLS key
- `--user-data-dir`: Path to user data directory
- `--extensions-dir`: Path to extensions directory

## Customizations

code-server applies various customizations to VS Code through the patch system, including:

- **Web Adaptations**: Modifications to make VS Code work well in a browser
- **Authentication**: Adding password-based authentication
- **Extension Marketplace**: Support for alternative marketplaces
- **Telemetry Adjustments**: Privacy-related changes
- **Proxy Support**: Integrated proxy for accessing ports on the remote machine

## Testing

The project includes several test types:

- **Unit Tests**: `npm run test:unit`
- **Integration Tests**: `npm run test:integration`
- **End-to-End Tests**: `npm run test:e2e`

The e2e tests use Playwright for browser automation.

## Packaging and Deployment

code-server can be deployed as:

- **Standalone Release**: Prebuilt binaries for various platforms
- **System Package**: DEB and RPM packages
- **Node.js Package**: Via npm
- **Docker Container**: Official Docker images
- **Cloud Deployment**: One-click deployments for various cloud providers

Build commands:
- `npm run release`: Creates a release build
- `npm run package`: Generates distribution packages
- `npm run release:standalone`: Creates standalone releases

## Documentation

Comprehensive documentation is available in the `/docs` directory:

- [Installation Guide](docs/install.md)
- [Setup Guide](docs/guide.md)
- [FAQ](docs/FAQ.md)
- [Contributing Guidelines](docs/CONTRIBUTING.md)
- Platform-specific guides (iPad, Android, etc.)

## License

code-server is released under the [MIT License](LICENSE).

---

For more information:
- [GitHub Repository](https://github.com/coder/code-server)
- [Official Documentation](https://coder.com/docs/code-server/latest)
- [Community Discussions](https://github.com/coder/code-server/discussions)
