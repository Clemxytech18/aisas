# AISAS brand assets

The AISAS symbol combines a geometric A, an upward radar sweep, and a discovery dot. The lockup includes the AISAS name and BY CLEMXYTECH credit.

- `aisas-logo-light.png`: horizontal logo for light surfaces.
- `aisas-logo-dark.png`: horizontal logo for dark surfaces.
- `aisas-app-icon.png`: square, opaque icon master for app and favicon preparation. Let the platform apply its corner mask.

Palette targets: electric lime `#C0F580`, evergreen `#16251D`, night background `#0A100F`, warm ivory `#EFF5ED`, and day background `#F5F6F1`.

These are high-resolution PNG raster assets with their intended surface backgrounds. Preserve the horizontal logo's aspect ratio. Use the icon at small sizes where the credit line would become unreadable. Keep clear space around the symbol and wordmark.

## Application integration

`src/components/Brand.tsx` selects the matching day/night horizontal logo and provides the compact brand icon. The artwork appears in navigation, authentication, settings, and the footer. `app.json` uses the square icon as the Expo app icon for iOS/Android and as `web.favicon`; Expo generates the browser favicon during web export.
