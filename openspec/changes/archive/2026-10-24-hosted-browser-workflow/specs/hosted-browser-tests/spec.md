# Spec Delta

## Purpose

How the browser test levels behave on a hosted runner without a GPU: which e2e tests run there, how tests wait for the viewer's chrome, and how the component tier is split into shards.

## ADDED Requirements

### Requirement: Screenshot-only tests are local

An e2e test whose assertions other than a screenshot comparison only check its preconditions SHALL call one shared helper, as its first statement, that skips it with a stated reason whenever screenshot comparisons are ignored. The predicate that ignores them (`CI` set) SHALL be defined once and used by both the helper and the Playwright configuration.

#### Scenario: On a hosted runner
- **WHEN** the e2e level runs with `CI` set
- **THEN** every screenshot-only test is reported as skipped with the reason, and none runs its setup

#### Scenario: On a maintainer's machine
- **WHEN** the e2e level runs with `CI` unset
- **THEN** every screenshot-only test runs and compares against its baseline as before

### Requirement: Every screenshot test is classified

A guard test SHALL fail when an e2e test takes a screenshot (calls `expectChromeScreenshot`, `expectCanvasScreenshot`, `expectCanvasStillRendering` or `toHaveScreenshot`) without either calling the screenshot-only helper or being listed, with the assertions it still checks on CI, as a test that runs there. A raw `.screenshot()` compared inside the test is not a baseline comparison and is out of scope.

#### Scenario: A new screenshot test without a decision
- **WHEN** a spec gains a test that calls a screenshot helper and is neither marked nor listed
- **THEN** the guard fails and names the file and the test title

#### Scenario: A marked test without a screenshot
- **WHEN** a test calls the screenshot-only helper but takes no screenshot
- **THEN** the guard fails, because the test would hide assertions CI checks

#### Scenario: The helper after setup
- **WHEN** the helper is not the first statement of the test body
- **THEN** the guard fails

#### Scenario: A stale entry
- **WHEN** a test listed as running on CI no longer exists or no longer takes a screenshot
- **THEN** the guard fails and names the entry

### Requirement: Keyboard tests reach the bar deterministically

An e2e test that opens a control-bar panel by keyboard SHALL first wait for the bar to collapse on its idle timer, then focus the reveal control and press Enter as a keyboard user does, and SHALL assert the bar open and the settings button focused before pressing it.

#### Scenario: A slow boot
- **WHEN** the bar has collapsed before the test reaches the settings button
- **THEN** the test still opens the panel by keyboard, because it never focuses a button inside an inert bar

#### Scenario: A fast boot
- **WHEN** the bar is still open when the page is ready
- **THEN** the test waits for the collapse first, so every machine takes the same path

### Requirement: Layout pins avoid font metrics

A component test SHALL pin a layout edge as a literal only when that edge does not depend on text metrics; an edge that follows content height SHALL be compared against the element's own earlier measurement.

#### Scenario: The phone settings sheet returns to its place
- **WHEN** a filled bottom box lifts the open sheet and is emptied again
- **THEN** the sheet's rect equals its first measurement, and its left, right and bottom edges equal 10, 380 and 834 px

### Requirement: Shard costs are runner measurements

The per-file costs that balance the component shards SHALL be seconds measured on a named hosted run of the workflow, rounded, with 1 s as the floor; a file that failed counts its failing time, timeouts included; a file missing from that run keeps its previous value until the next measurement.

#### Scenario: Rebalancing
- **WHEN** the table is rewritten from a runner job's per-file times
- **THEN** the table test still lists exactly the component files on disk
