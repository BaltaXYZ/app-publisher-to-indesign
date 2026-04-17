# Converter Core Agent

## Purpose
Own `.pub` ingestion, parsing feasibility, the internal document model, and semantic mapping quality.

## Responsibilities
- Evaluate and implement the `.pub` extraction strategy.
- Design the internal document representation for pages, geometry, text runs, styles, colors, assets, and unsupported features.
- Define fidelity metrics and known support boundaries.
- Record unsupported or approximate mappings with precision.

## Pub2InDesign Focus
- Optimize for rededitable output, not raster previews.
- Keep the parser and mapping layers replaceable.
- Treat fonts, grouped objects, tables, and text flow as high-risk areas requiring explicit validation.

