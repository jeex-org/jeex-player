# asset-offers Specification

## Purpose
How a host hands the viewer an extra library of assets to replace with (`offers`, by URL or inline), how it is loaded and validated, and the order in which the project library, offers and the bundled bank resolve an asset.

## Requirements

### Requirement: Offers option

The viewer SHALL accept `offers` as `{ url }` (also the `offers` attribute) or `{ library, baseUrl }`, where `library` uses the project-library format and `baseUrl` is an absolute folder URL. A library that fails validation or cannot be fetched SHALL be reported as a warning; the scene SHALL still open and the bundled bank SHALL be offered instead.

#### Scenario: Offers by URL
- **WHEN** `offers` names the URL of a valid library file
- **THEN** its objects are offered, and its relative model and preview paths resolve against that file's folder

#### Scenario: Broken offers
- **WHEN** the offers file is not valid
- **THEN** a warning is logged, the scene opens and the bundled bank is offered

### Requirement: Offers before the document

Offers given by URL SHALL be loaded before the document is validated, so the mount waits for them. An offers library whose id equals the project library's SHALL be refused with the same warning.

#### Scenario: Document already names offers
- **WHEN** a document whose placement names the offers library is opened with that `offers`
- **THEN** it validates and renders; without `offers` it is refused as naming an unknown library

#### Scenario: Bare scene with offers
- **WHEN** a scene without a project is opened with `offers`
- **THEN** offers assets resolve, render and can be placed by `replace_asset`

### Requirement: Public library helpers

`jeex-viewer/ops` SHALL export `parseProjectLibrary`, which validates a bare library object, and `libraryOf`, which turns one into the registries input, so a host validates a document that names an offers library the way the viewer does.

#### Scenario: Host validation
- **WHEN** a host validates a document naming the offers library with `libraryOf(parseProjectLibrary(offers))`
- **THEN** the document is accepted

### Requirement: Lookup order

The renderer, the validator and the panels SHALL resolve an asset in the project library first, then in offers, then in the bundled bank. A placement whose `library` is the offers library's id SHALL resolve in offers, with its model, preview, materials and textures loaded from the offers folder.

#### Scenario: Replaced with an offer
- **WHEN** a placement is replaced by an offers asset
- **THEN** the scene validates, and the new body is loaded from the offers folder under the same placement id
