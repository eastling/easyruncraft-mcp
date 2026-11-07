# PdfCraft CLI inventory

The pinned PdfCraft CLI 0.8.0 reports 163 entries from `pdfcraft-cli tools`. The public [MCP operation catalog](../mcp/pdf-capabilities.json) describes the operations users can request. Native command names are grouped below by how EasyRunCraft uses them. PNG rendering uses the CLI’s `render` subcommand.

## Used by the external service (39)

The service wraps these calls with explicit parameters and ownership checks. Some native options, such as file-based watermarks or split by bookmarks, still need their own integration.

`doc_open`, `doc_info`, `doc_save`, `doc_set_info`, `page_render`, `text_extract`, `text_find`, `page_rotate`, `page_delete`, `page_move`, `page_insert_blank`, `page_extract`, `doc_combine`, `doc_split`, `bookmark_list`, `bookmark_add`, `bookmark_rename`, `bookmark_delete`, `bookmark_set_page`, `page_number`, `form_fields`, `form_fill`, `form_reset`, `page_add_text`, `link_list`, `comment_list`, `comment_add`, `page_duplicate`, `page_set_box`, `doc_header_footer`, `doc_watermark`, `doc_remove_marks`, `text_lines`, `text_edit`, `doc_optimize`, `doc_flatten`.

## Local device, credentials or general automation (22)

These require device or account integration, or an explicit boundary around arbitrary commands, scripts, local paths and external actions.

`doc_batch`, `printers`, `printer_options`, `doc_print`, `link_open`, `sign_id_create`, `sign_windows_ids`, `sign_keychain_ids`, `sign_document`, `sign_trust`, `doc_protect`, `doc_unprotect`, `js_run`, `js_document_scripts`, `js_set_document_script`, `form_set_script`, `action_list`, `action_run`, `js_enabled`, `command_list`, `command_run`, `command_batch`.

## Editor session and UI state (9)

These depend on an editor session, or duplicate inspection that is already available as a bounded file task.

`doc_list`, `doc_close`, `comments_hide`, `view_reading_colors`, `doc_open_revision`, `edit_undo`, `edit_redo`, `doc_inspect`, `render_preview`.

## Redaction and sanitization (6)

These need a separate end-to-end check for removal of recoverable data before the service can promise those outcomes.

`redact_mark`, `redact_apply`, `redact_clear`, `doc_hidden_info`, `doc_remove_hidden`, `doc_audit_redactions`.

## Native commands awaiting remote validation (87)

These have a CLI entry. They still need suitable inputs and outputs, bounded parameters, runtime dependencies where applicable, and tests using representative files.

`object_list`, `object_move`, `page_enhance_camera`, `doc_create_multiple`, `bookmark_move`, `bookmark_from_structure`, `form_add_field`, `stamp_custom`, `form_set_image`, `form_set_props`, `form_tab_order`, `doc_export_data`, `doc_import_data`, `form_delete_field`, `content_list`, `page_add_image`, `content_update`, `content_delete`, `link_add`, `link_edit`, `link_delete`, `links_from_urls`, `links_remove`, `measure_distance`, `measure_perimeter`, `measure_area`, `measure_info`, `measure_list`, `measure_scale`, `measure_snap`, `measure_export`, `comment_reply`, `comment_set_status`, `sign_list`, `comment_mark`, `comment_lock`, `comments_summarize`, `comment_edit`, `comment_image_preview`, `comment_delete`, `doc_export_images`, `accessibility_autotag_preview`, `accessibility_autotag_apply`, `accessibility_check`, `accessibility_report`, `accessibility_review_record`, `accessibility_review_save`, `accessibility_review_load`, `accessibility_review_html`, `accessibility_fix`, `accessibility_figures`, `accessibility_set_alt`, `accessibility_tags`, `accessibility_set_tag_property`, `accessibility_move_tag`, `form_merge_data`, `doc_export_office`, `pdfa_verify`, `print_readiness`, `pdfa_convert`, `doc_compare`, `doc_compare_report`, `doc_compare_mark`, `form_detect_fields`, `form_actions`, `form_set_actions`, `ocr_recognize`, `ocr_recognize_files`, `ocr_status`, `doc_export_all_images`, `doc_export_text`, `fill_sign_add`, `fill_sign_date_format`, `doc_create`, `doc_reduce`, `doc_initial_view`, `doc_audit_space`, `image_hit`, `page_images`, `image_edit`, `image_save`, `text_font_files`, `text_font_import`, `text_fonts`, `text_paragraphs`, `text_edit_layout`, `doc_revisions`.
