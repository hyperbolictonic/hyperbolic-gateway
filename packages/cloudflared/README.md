# @kuang/cloudflared

Managed downloader for the official Cloudflare `cloudflared` binary.

- Resolves the correct GitHub release for the current platform.
- Downloads only after the caller explicitly asks.
- Requires a SHA-256 digest from the GitHub release asset.
- Verifies the downloaded bytes before installation.
- Installs atomically into `<dataDir>/bin/`.
- Supports Windows x64, macOS arm64/x64, and Linux x64/arm64.
- Never auto-installs on import.

`cloudflared` is Apache-2.0 software from Cloudflare. This package only
downloads the official binary; it does not redistribute it.
