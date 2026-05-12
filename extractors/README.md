# Marketplace rendered extractors

Version 012 moves extraction logic into a marketplace-aware strategy in `feed-renderer.mjs`.
The current renderer uses Temu/AliExpress/SHEIN selector families, image-centered ancestor grouping,
autoscroll hydration, product-detail link scoring, and duplicate removal.

Future marketplace-specific extractors can be split into this folder when individual sites need deeper tuning.
