# code-server: VS Code in the Browser - Technical Architecture

This document provides a technical overview of how code-server works, focusing on the modifications made to VS Code and the code-server specific components. It also explains what to expect from the final application build.

## Table of Contents

- [VS Code Modifications](#vs-code-modifications)
- [code-server Specific Code](#code-server-specific-code)
- [Build Process](#build-process)
- [Final Application Components](#final-application-components)
- [Key Technical Features](#key-technical-features)
- [Architecture Diagram](#architecture-diagram)

## VS Code Modifications

code-server includes VS Code as a Git submodule and applies a series of patches to make it work in a browser environment with added functionality. These patches (located in the `/patches` directory) include:

### Core Web Adaptations

1. **Integration Patch** (`integration.diff`)
   - Prepares VS Code for integration with code-server
   - Modifies the entry point to allow importing VS Code instead of running it directly
   - Filters code-server environment variables from the terminal
   - Adds code-server version to the help dialog
   - Modifies icons and manifest

2. **Base Path** (`base-path.diff`)
   - Enables VS Code to run under a sub-path (not just at the domain root)
   - Critical for reverse proxy setups behind paths

3. **Webview Integration** (`webview.diff`)
   - Modifies webviews to be served from the same origin
   - Adjusts Content Security Policy to allow 'self' resources
   - Prevents service worker conflicts with self-hosted webviews

### Authentication & Security

4. **Logout Functionality** (`logout.diff`)
   - Adds a logout command and menu item when authentication is enabled

5. **Trusted Domains** (`trusted-domains.diff`)
   - Allows configuring trusted domains via product.json or command-line flag

6. **Signature Verification** (`signature-verification.diff`)
   - Modifies how extension signatures are verified for compatibility

### Extension Management

7. **Marketplace Support** (`marketplace.diff`)
   - Adds Open VSX as the default marketplace
   - Allows configuring custom extension galleries via environment variables
   - Fixes web extension installation paths

8. **Disable Built-in Extension Updates** (`disable-builtin-ext-update.diff`)
   - Prevents built-in extensions from updating themselves
   - Ensures consistency in the code-server environment

### User Experience

9. **Getting Started** (`getting-started.diff`)
   - Customizes the welcome/getting started experience for code-server

10. **Clipboard Support** (`clipboard.diff`)
    - Improves clipboard integration between browser and editor

11. **Local Storage** (`local-storage.diff`)
    - Modifies local storage handling for browser environment

12. **Telemetry** (`telemetry.diff`)
    - Disables or modifies telemetry collection

13. **Update Check** (`update-check.diff`)
    - Modifies the update checking mechanism

14. **Proxy URI** (`proxy-uri.diff`)
    - Enables the built-in port forwarding capabilities

## code-server Specific Code

Apart from the VS Code modifications, code-server adds its own components to provide additional functionality. Key components include:

### Server Components (`src/node/`)

1. **HTTP Server & Authentication** (`http.ts`)
   - Express-based web server with middleware for authentication
   - Cookie-based session management
   - Rate limiting for login attempts (2 per minute + 12 per hour)

2. **Login System** (`routes/login.ts`)
   - Password-based authentication system
   - Login page rendering with localization support

3. **VS Code Integration** (`routes/vscode.ts`)
   - Connects the code-server HTTP layer to the VS Code web server
   - Handles request proxying and WebSocket upgrades

4. **Socket Proxy** (`socket.ts`)
   - Provides TLS socket proxying capability
   - Enables secure communication between components

5. **CLI Interface** (`cli.ts`)
   - Parses command-line arguments and config files
   - Defines the available options for configuring code-server

### Browser Components (`src/browser/`)

1. **Service Worker** (`serviceWorker.ts`)
   - Handles caching and offline support
   - Manages communication between browser and server

2. **Login Page** (`pages/login.html`)
   - Browser-side authentication interface

### Common Utilities (`src/common/`)

1. **Shared Utilities** (`util.ts`)
   - Functions used by both server and browser components

2. **Event Emitter** (`emitter.ts`)
   - Custom event system for component communication

## Build Process

The build process for code-server involves several steps, orchestrated through scripts in the `ci/build/` directory:

1. **Build Code Server** (`build-code-server.sh`)
   - Compiles TypeScript sources to JavaScript
   - Outputs to `out/` directory
   - Adds shebang to entry point script

2. **Build VS Code** (`build-vscode.sh`)
   - Builds VS Code with necessary modifications
   - Applies patches from `patches/` directory using quilt
   - Outputs to `lib/vscode/out-vscode`

3. **Build Release** (`build-release.sh`)
   - Combines code-server and VS Code builds
   - Prepares package.json and product.json
   - Creates a generic NPM package

4. **Build Packages** (`build-packages.sh`)
   - Creates platform-specific packages
   - Generates compressed archives (.tar.gz)
   - Creates installers (.deb, .rpm) for Linux

5. **Standalone Release** (`build-standalone-release.sh`)
   - Bundles Node.js with code-server
   - Creates self-contained packages that don't require Node.js installation

## Final Application Components

The final built application consists of:

1. **Server Binary/Script**
   - Entry point (`out/node/entry.js`)
   - Node.js backend server

2. **VS Code Web Application**
   - Modified VS Code web client
   - Bundled frontend resources

3. **Extension Support**
   - Extension loading mechanism
   - Open VSX Registry integration by default

4. **Configuration**
   - Default configuration files
   - User settings storage

5. **Documentation**
   - Readme and usage instructions

## Key Technical Features

1. **Authentication System**
   - Password-based authentication (default)
   - Option for password-less operation in secure environments
   - Rate limiting to prevent brute force attacks

2. **HTTPS Support**
   - Built-in TLS support
   - Self-signed certificate generation
   - Option to use custom certificates

3. **Proxy System**
   - Built-in port forwarding
   - Access to services running on the host machine

4. **Extension Management**
   - Open VSX Registry integration
   - Custom marketplace configuration
   - Local extension installation

5. **Multi-user Awareness**
   - Session management
   - User-specific data directories
   - Service isolation

## Architecture Diagram

```
+----------------------+       +------------------------+
|   Browser Client     |       |  Command Line Client   |
+----------+-----------+       +------------+-----------+
           |                               |
           v                               v
+----------+-----------+       +-----------+------------+
|   HTTP/WS Server     |<----->|  CLI Interface         |
|   (Express)          |       |  (Extension mgmt, etc) |
+----------+-----------+       +------------------------+
           |
+----------v-----------+
|   Authentication     |
|   & Session Mgmt     |
+----------+-----------+
           |
+----------v-----------+
| Modified VS Code     |
| Server               |
+----------+-----------+
           |
+----------v-----------+
| File System Access   |
| & Process Execution  |
+----------------------+
```

In the final application, all these components work together to provide a seamless VS Code experience in the browser, with added security, authentication, and remote access capabilities.
