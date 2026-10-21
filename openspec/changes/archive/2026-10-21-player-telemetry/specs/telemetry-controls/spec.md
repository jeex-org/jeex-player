# Spec Delta

## Purpose

Defines how a site and a visitor's browser control the player's telemetry, and how the iframe page learns which page embeds it without that page's address passing through any URL.

## ADDED Requirements

### Requirement: On by default

Telemetry SHALL be on when nothing turns it off, and SHALL send to `https://telemetry.jeex.org/v1/player`.

#### Scenario: Default embed

- **WHEN** a page embeds the player with no telemetry option
- **THEN** a `view` send is made to the default endpoint

### Requirement: Off switch

`analytics="off"` on `<jeex-viewer>`, `?analytics=off` on the iframe page (an `embedViewer` option `analytics: 'off'`), and `analytics: 'off'` or `{ mode: 'off' }` for `mountViewer` SHALL make the player send nothing at all, at mount, on errors, timers, hide, `pagehide` or dispose. It fails closed: only an absent value or exactly `on` sends.

#### Scenario: Every other spelling is off

- **WHEN** the value is `OFF`, `none`, `false`, `null`, an empty attribute or any unknown value, in any embed form
- **THEN** no telemetry request is made

#### Scenario: Element switched off

- **WHEN** `<jeex-viewer analytics="off">` is mounted, used, hidden and removed
- **THEN** no request is made to any telemetry endpoint

### Requirement: Global Privacy Control

When `navigator.globalPrivacyControl === true` the player SHALL send nothing, as with `off`, and SHALL check it again before every send.

#### Scenario: GPC set

- **WHEN** the browser reports Global Privacy Control
- **THEN** no telemetry request is made during the whole mount

### Requirement: Endpoint override

`analytics-endpoint` (element), `?analyticsEndpoint=` (iframe page) and `analytics.endpoint` (`mountViewer`) SHALL replace the endpoint when the value is an absolute `https:` URL, or an `http:` URL on `localhost` or `127.0.0.1`. Any other value, including a value that is not a string, SHALL turn sending off and log one warning; it SHALL NOT fall back to the default endpoint.

#### Scenario: Valid override

- **WHEN** `analytics-endpoint="https://stats.agency.example/player"` is set
- **THEN** sends go to that URL and none to the default endpoint

#### Scenario: Invalid override

- **WHEN** `analytics-endpoint="ftp://stats.example/"` is set
- **THEN** no telemetry request is made and the host's log sink receives one warning

#### Scenario: A non-string override through the API

- **WHEN** `mountViewer` is given `{ analytics: { endpoint: 42 } }`
- **THEN** no telemetry request is made to any endpoint, the default included, and one warning is logged

### Requirement: Off does not change the player

Turning telemetry off SHALL change nothing else: scenes, models and every other request the player makes are unchanged.

#### Scenario: Same scene requests

- **WHEN** the same page is loaded with telemetry on and off
- **THEN** the scene and model requests are the same

### Requirement: Iframe host page context

The iframe page SHALL accept one `context` command `{ page }` from its host, only from the parent window and the bridge's host origin, and use the sanitised path as `page` for later sends. The host helper SHALL post it after the frame loads, by `postMessage` only; the host path SHALL NOT appear in the frame's URL.

#### Scenario: Host helper hands over its page

- **WHEN** `embedViewer` embeds the frame on `https://agency.example/listing/1234567?utm=x`
- **THEN** the frame's URL contains no host path, and sends after the context arrives carry `page: "/listing/:id"`

#### Scenario: Context from another origin is ignored

- **WHEN** a window other than the parent, or the parent on another origin, posts a `context` command
- **THEN** the frame's `page` stays as it was

### Requirement: Iframe site

In the iframe page, `site` SHALL be the browser-reported origin of the embedding document (`location.ancestorOrigins[0]`) where the browser provides it, else the host origin once the bridge has accepted a message from it, else `null`. `view` and `ready` SHALL wait for the host's `context`, at most 2 seconds or until the first flush, and are then sent with what is known.

#### Scenario: View and ready name the host page

- **WHEN** the host helper embeds the frame and hands over its context
- **THEN** the `view` and `ready` sends carry `page` and `site` of the host page

#### Scenario: Browser without ancestor origins

- **WHEN** the frame runs where `location.ancestorOrigins` is not available
- **THEN** `view` and `ready` carry the host origin the bridge verified, once the context has arrived

#### Scenario: A host that sends no context

- **WHEN** a hand-written host never sends `context`
- **THEN** `view` and `ready` leave after 2 seconds with `page: null`
