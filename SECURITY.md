# Security policy

## Supported versions

| Version | Supported |
|---|---|
| `0.1.x` | Yes |

Before `1.0` there is no long-term-support branch: security fixes land on
`main`, ship in the next `0.1.x` release and are listed in `CHANGELOG.md`.

## Scope

This policy covers what this repository builds and publishes:

- **The player library**: the ES module and IIFE builds, the
  `<jeex-viewer>` custom element, the `jeex-viewer/ops` entry and the
  `jeex-viewer/host` iframe helper.
- **The embed frame**: `embed.html` with `jeex-viewer-frame.js`, and the
  postMessage bridge between a host page and the frame.
- **The site** under `site/`: the player's own web pages and the demo they
  serve.

Examples of issues in scope: origin validation on the postMessage bridge,
script injection through the player's chrome or a scene or project document,
unsafe handling of a host-supplied scene URL, project manifest or GLB (a
fetch outside the project's folder, a credentialed request, a missing size
limit), a way around the iframe sandbox, and supply-chain issues in this
repository's build output.

Out of scope: a deployment's own server configuration (for example a missing
`frame-ancestors` header on a hosted `embed.html`, which `README.md` asks the
deployer to set), and issues in third-party dependencies that are not
reachable through the player. Report those to the operator or the upstream
project.

## Reporting a vulnerability

Report privately through GitHub's private vulnerability reporting:

- open <https://github.com/jeex-org/jeex-player/security/advisories/new>, or
- go to the repository's **Security** tab and choose **Report a
  vulnerability**.

Do not open a public issue or pull request for a security report.

Please include:

- the affected version, or the commit if you built from source;
- the integration path (ES module, custom element or iframe) and the browser
  with its version;
- a description of the issue and its impact;
- the steps to reproduce, ideally a minimal host page, scene or project that
  triggers it;
- any proof-of-concept code, logs or screenshots;
- whether you want to be credited, and under which name.

We aim to acknowledge a report within 5 business days and to keep you
informed while we investigate and fix it.

## Coordinated disclosure

We ask for 90 days from the date we confirm a report before public
disclosure, to allow time to investigate, fix and release. If a fix ships
sooner, we agree a disclosure date with the reporter and publish a GitHub
security advisory. If 90 days pass without a fix, the reporter may disclose
publicly; please tell us in advance.

There is no bug bounty programme.
