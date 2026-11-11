# Pure icon set (embedded)

The SVG files in this folder are a small subset of the **Pure** icon theme
(https://github.com/mjkim0727/Pure-icon-theme), copied unmodified from the
`64/places` and `64/mimetypes` directories:

- `folder.svg` and `folder-{red,orange,yellow,green,blue,purple,pink,grey}.svg`
- `image-x-generic.svg`, `video-x-generic.svg`, `audio-x-generic.svg`
- `package-x-generic.svg`, `text-x-generic.svg`, `text-x-script.svg`
- `x-office-document.svg`, `application-pdf.svg`
- `x-office-spreadsheet.svg`, `x-office-presentation.svg`, `unknown.svg`

They are inlined into the renderer bundle (`pure-icons.ts` via Vite `?raw`) so
the default file and folder icons look the same on every OS, including macOS
where the theme is not installed.

## License

The Pure icon theme is licensed under the **GNU General Public License v3.0**
(see `LICENSE` next to this file). The rest of Max File Manager remains MIT;
these SVG assets are an aggregate work under their own license.

Upstream author: mjkim0727 and contributors.
