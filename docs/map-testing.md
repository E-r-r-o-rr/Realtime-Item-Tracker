# Floor Map QA Scenarios

This document captures the manual checks run against the floor-map workflow. The goal is to verify multi-map coverage, destination lookups, and navigation hand-off without regressions.

## Prerequisites

1. Open the dashboard and navigate to the Home view.
2. Scroll to **Map Administration** and upload at least three floor variants using the built-in uploader. For quick testing you can reuse any internal warehouse schematics or the bundled sample SVG (`public/images/warehouse-grid.svg`).
3. Annotate each map with a handful of destinations. For example:
   - `floor1`: add points for `Dock 3`, `R1-A`, and `W9`.
   - `floor1-section-a`: add `D3` as a synonym of `Dock 3` and mark a distinct rack (e.g., `A-12`).
   - `floor2`: add a high-bay label such as `WH-12` and a staging zone (`Outbound B`).
4. Provide approximate georeference details (origin, scale, rotation) or leave defaults if precise indoor GPS is not available—the module will still derive consistent lat/lon pairs from pixel coordinates.

## Scenario Matrix

| Scenario | Steps | Expected Result |
| --- | --- | --- |
| Multi-map coverage | Upload the three maps above, then open each one in the admin panel to confirm annotations render and can be edited. | All maps list their annotated points, and the overlay markers appear in the click-to-annotate preview. |
| Destination change | Use **Load Camera Demo** twice to cycle through sample OCR payloads. Observe the **Floor Map Navigation** panel. | The destination card updates immediately, the marker jumps to the mapped point on the selected map, and status text reflects the new label. |
| Synonym resolution | Annotate a point with synonyms (`Dock 3`, `D3`, `Bay 3`). Scan an order containing `D3`. | The runtime lookup resolves to the `Dock 3` pin automatically. Suggestions list stays empty because an exact synonym matched. |
| Ambiguity fallback | Temporarily remove one synonym, scan `D3` again. | No exact match is found; the suggestions panel lists nearby matches. Clicking a suggestion selects it and updates the navigation payload preview. |
| Navigation stub | With a match selected, click **Start Navigation**. | A POST request to `/api/navigation/start` succeeds, and the UI confirms the payload queued state. |
| Refresh guard | Leave the dashboard idle for five minutes (or refresh the page after that interval). | Uploaded maps and annotations persist; re-running a scan still resolves the same coordinates without errors. |

## Notes

- All coordinates are derived from the map’s georeference. Even with approximate indoor GPS values, the payload always includes both `{lat, lon}` and the exact `{x_px, y_px}` for downstream modules.
- The module can operate with coarse geodata. When no origin is specified the UI still surfaces the local pixel coordinates, allowing the navigation service to align against indoor positioning systems.
- The admin uploader accepts common web image formats (PNG, JPG, SVG, WebP). Uploaded files are stored in `data/maps/` and served via `/api/floor-maps/{id}/image`.
- Authentication is currently disabled across the dashboard and APIs; no login is required for testing.
