# EasyRunCraft native editor MCP

These tools use official headless CLIs. EasyRunCraft maps explicit operations to fixed command IDs and arguments inside its existing native job runner. Clients cannot supply native commands, file paths or arbitrary URLs. The browser workbench has its own document and undo history.

| Editor and upstream release | Official Linux x86_64 archive | MCP scope |
| --- | --- | --- |
| [PhotoCraft v0.9.0](https://github.com/storytold/photocraft/releases/tag/v0.9.0) | `photocraft-0.9.0-linux-x86_64.tar.gz` includes `bin/photocraft-cli` | `process_photo`: inspect canvas and layers, resize, rotate, flip, convert PNG/JPEG/WebP/PSD. |
| [WordCraft v0.7.0](https://github.com/storytold/wordcraft/releases/tag/v0.7.0) | `wordcraft-0.7.0-linux-x86_64.tar.gz` includes `bin/wordcraft-cli` | `process_word`: DOCX metadata, paged body text, append one paragraph, export PDF. |
| [DeckCraft v0.7.0](https://github.com/storytold/deckcraft/releases/tag/v0.7.0) | `deckcraft-0.7.0-linux-x86_64.tar.gz` includes `bin/deckcraft-cli` | `process_deck`: PPTX overview, inspect a slide, replace speaker notes, render one slide to PNG. |
| [VectorCraft v0.13.1](https://github.com/storytold/vectorcraft/releases/tag/v0.13.1) | `vectorcraft-0.13.1-linux-x86_64.tar.gz` includes `bin/vectorcraft-cli` | `process_vector` inspects native design files, adds rectangles and ellipses, and exports one artboard as PNG or PDF. |
| [FigCraft v0.6.0](https://github.com/storytold/figcraft/releases/tag/v0.6.0) | `figcraft-0.6.0-linux-x86_64.tar.gz` includes `bin/figcraft-cli` | `process_fig` lists pages and frames, adds rectangles to a page, exports a top-level frame as PNG, and exports a page as PDF. |
| [CADCraft v0.8.0](https://github.com/storytold/cadcraft/releases/tag/v0.8.0) | `cadcraft-0.8.0-linux-x86_64.tar.gz` includes `bin/cadcraft-cli` | `process_cad` inspects standalone text DXF drawings, adds lines and circles, and exports model space as PNG or PDF. |

These are the native versions selected for this integration, independent of the browser version or the latest upstream release. The pinned releases also publish universal macOS CLI ZIPs. Linux and macOS locks are in [native-runtimes.json](../deployment/native-runtimes.json).

## Request flow

1. Call `editor_capabilities` for the requested editor, for example `vector` or `effect`. Each result points to the product’s public MCP guide.
2. Call `create_upload` and PUT the source bytes to its signed URL.
3. Submit the job with the same `file_id`, a new `request_id` and an operation supported by the editor. Jobs use private copies.
4. Poll `get_job`, then read its structured result or download the output. WordCraft reopens the DOCX to verify the appended paragraph; DeckCraft reopens the PPTX to verify its notes. Use the original upload for another independent edit, or use the output file_id to continue editing the result without another upload.

## Layout, photo development, audio and video

| Editor and upstream release | CLI in Linux x86_64 archive | MCP workflow |
| --- | --- | --- |
| [DesignCraft v0.8.0](https://github.com/storytold/designcraft/releases/tag/v0.8.0) | `bin/designcraft-cli` | Inspect a native layout, add a text frame and export selected pages to PDF. Upload a standalone package with embedded assets and no data merge sources. |
| [LightCraft v0.8.0](https://github.com/storytold/lightcraft/releases/tag/v0.8.0) | `bin/lightcraft-cli` | Inspect and develop one DNG, JPEG, PNG or WebP. Export JPEG, PNG or WebP. |
| [SoundCraft v0.8.0](https://github.com/storytold/soundcraft/releases/tag/v0.8.0) | `bin/soundcraft-cli` | Inspect WAV, FLAC or MP3. Convert with optional normalization or mix a gain adjustment to WAV. |
| [FilmCraft v0.13.0](https://github.com/storytold/filmcraft/releases/tag/v0.13.0) | `bin/filmcraft-cli` | Inspect an MP4 or MOV, export a frame, or trim up to eight seconds to MP4. |
| [EffectCraft v0.17.0](https://github.com/storytold/effectcraft/releases/tag/v0.17.0) | `bin/effectcraft-cli` | Inspect a native project, add text to its active composition, and render frames or up to five seconds of silent MP4. Use self-contained projects. |

PdfCraft and GridCraft retain their dedicated tools. Each of the 13 editors has a guide linked from the MCP setup page. The capabilities catalog describes the hosted operations. Browser-only commands and workflows that depend on external project media are outside those hosted operations.

## CLI evidence

Pre-implementation sample probes exercised edits and exports in all five official macOS CLIs. For example, FilmCraft opened an MP4 into a sequence and returned both PNG and a trimmed MP4. EffectCraft rendered a composition range through its scoped native MCP server. The native installer checks official archives and extracted executable hashes for macOS and Linux. The deployment workflow builds the Linux image and checks the running service separately.
