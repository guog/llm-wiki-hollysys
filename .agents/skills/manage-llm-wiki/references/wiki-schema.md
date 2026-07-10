# Wiki schema and citation rules

Every generated page must use YAML frontmatter with these fields:

```yaml
title: Example
kind: source
schema_version: 1
sources:
  - path: raw/example.pdf
    checksum: sha256:...
    locators:
      - page:1
generated:
  model: deepseek-v4-flash
  at: 2026-07-10T00:00:00.000Z
```

Allowed `kind` values are `source`, `concept`, `entity`, `comparison`, and `answer`. The page path must use the matching plural directory and end in `.md`.

Use collection-relative source paths such as `raw/spec.pdf` or `canonical/report-xlsx.md`. Never write absolute paths.

Attach a citation marker to material claims with the form `[来源: raw/spec.pdf#page:3]`. Use `document` when the parser cannot provide a finer locator. Preserve existing source entries when updating a page.

Use `[[wikilinks]]` for navigation. Do not create a link target outside the Wiki collection.
