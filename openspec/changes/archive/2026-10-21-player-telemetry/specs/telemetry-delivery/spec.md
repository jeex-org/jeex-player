# Spec Delta

## Purpose

Defines when telemetry sends leave the player, in what request shape, and how failures, repetition and several viewers on one page are handled, so that telemetry never slows, breaks or duplicates anything.

## ADDED Requirements

### Requirement: Request shape

Each send SHALL be one `POST` to the endpoint made with `fetch` and `keepalive: true`, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `mode: 'cors'`, `cache: 'no-store'`, `redirect: 'error'`, a JSON string body and no custom headers. `navigator.sendBeacon` SHALL NOT be used.

#### Scenario: A send carries no credentials and no referrer

- **WHEN** any send is made
- **THEN** the request has credentials mode `omit`, referrer policy `no-referrer` and a body that parses as one JSON object

### Requirement: Groups are separate requests

Sends of different groups SHALL be separate requests, and each distinct error report SHALL be its own request. No field SHALL tie the sends of one view together beyond the shared context.

#### Scenario: One flush, several requests

- **WHEN** a flush has actions, rooms, device data and two distinct errors to send
- **THEN** five requests are made, one per group and one per error

### Requirement: When sends leave

`view` SHALL be sent once per mount when it mounts; `ready` when the first frame of each shown scene is drawn. Everything else, `models_loaded` included, SHALL be accumulated in memory and sent when the document becomes hidden, on `pagehide`, every 5 minutes while mounted, before a scene replacement and on dispose; what was sent is reset.

#### Scenario: Hidden flush

- **WHEN** the visitor switches tabs after using the player
- **THEN** the accumulated groups are sent and the counters start again from zero

#### Scenario: Scene replacement does not relabel data

- **WHEN** the host loads another scene
- **THEN** the data gathered for the previous scene is sent with the previous `subject` before the new scene is announced

#### Scenario: Nothing to send, nothing sent

- **WHEN** a flush finds no pending `models_loaded`, no counts, no room time, no drawn frames and no errors
- **THEN** no request is made

### Requirement: Overlapping triggers send once

A flush SHALL take and reset its snapshot synchronously, so that triggers arriving together (hidden and `pagehide`, a timer and dispose) send each piece of data once.

#### Scenario: Hidden then pagehide

- **WHEN** `visibilitychange` to hidden and `pagehide` fire back to back
- **THEN** each accumulated group is sent once

### Requirement: Failures are swallowed

A network failure, a rejected or throwing `fetch`, a missing `fetch` or a refused body SHALL be swallowed without retry, without a log entry on the host's sink and without an error report about telemetry itself. Telemetry SHALL NOT delay the first frame.

#### Scenario: Endpoint unreachable

- **WHEN** the endpoint does not resolve
- **THEN** the player renders and behaves exactly as without telemetry, and no retry is made

### Requirement: Error deduplication and caps

Error reports SHALL be deduplicated by code, stage, name and frames into one report with a `count` (at most 50), and at most 10 error sends SHALL be made over the whole mount, across every flush.

#### Scenario: A repeating error

- **WHEN** the same player error happens 12 times before a flush
- **THEN** one error send is made with `count: 12`

#### Scenario: Error sends are capped across flushes

- **WHEN** a player error keeps recurring across many timer, hidden and scene-replacement flushes
- **THEN** no more than 10 error sends are made for the mount

### Requirement: Page-wide error listeners

Page-wide `error` and `unhandledrejection` listeners SHALL be installed once per page while at least one viewer with telemetry on is mounted, SHALL pass on only errors with an own frame, and SHALL route each one to a single viewer, so that one error is reported once.

#### Scenario: Two viewers, one error

- **WHEN** two viewers are mounted and a player error reaches the page-wide listener
- **THEN** exactly one error report is made for it
