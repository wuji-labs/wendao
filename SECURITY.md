# Security Policy

## Supported versions

Wendao is pre-1.0 and ships from `main`. Security fixes land on `main` and in the latest tagged
release. Please run a recent version before reporting.

## Reporting a vulnerability

**Please do not open a public issue, pull request, or Discussion for security vulnerabilities.**

Report privately via either:

- GitHub's **[Report a vulnerability](https://github.com/wuji-labs/wendao/security/advisories/new)**
  (Security → Advisories), or
- email **security@wuji-labs.org**

Please include:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- affected component (web / api / worker / asr) and version or commit.

We aim to acknowledge reports within **5 business days** and to provide a remediation plan once
the issue is confirmed. We'll credit reporters in the advisory unless you prefer to remain
anonymous.

## Scope & shared responsibility

Wendao is **self-hosted software**. A large part of your security posture is your deployment:

- Wendao's default auth is a simple `x-user-id` header intended for trusted/LAN use. **Do not
  expose an unauthenticated instance to the public internet** — put it behind your own
  authentication / reverse proxy. See [`docs/self-hosting.md`](docs/self-hosting.md).
- You are responsible for your own secrets (`DATABASE_URL`, `HF_TOKEN`, Ollama credentials),
  database hardening, TLS termination, and access control.
- Uploaded media and transcripts may contain sensitive data; secure your `MIAOJI_STORAGE_DIR`
  and any archive directory accordingly.

In-scope reports include: authentication/authorization bypass within the app's own checks,
injection, SSRF, path traversal in media/storage handling, and similar code-level
vulnerabilities. Out of scope: issues that require an already-compromised host, missing
hardening that is the operator's responsibility, and vulnerabilities in third-party models or
dependencies (report those upstream, but feel free to flag them to us too).
