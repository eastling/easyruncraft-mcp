# EasyRunCraft 外部 MCP 命令接入盘点

这份盘点记录扩充 PDF 工具前的基线。当前 PDF 能力见 [PdfCraft CLI 盘点](pdf-mcp-inventory.md)；后续接入的 PhotoCraft、WordCraft、DeckCraft、VectorCraft、FigCraft、CADCraft 见 [原生编辑器 CLI 盘点](editor-mcp-inventory.md)。

盘点范围为 EasyRunCraft 的 13 个编辑器在 `src/editors/*/lib/edit-tools.ts` 中声明的 84 个浏览器 Agent 命令。外部接入按**上传文件或创建项目 → 在服务端执行 → 下载结果**评估。浏览器中已经打开的文档属于另一个执行环境。

当前 `/mcp` 对外注册 7 个工具，其中 GridCraft 和 PdfCraft 负责文件执行。84 个浏览器命令名均未独立注册到外部端点。下表的分类表示所需工作，依据仓库、已有运行时及上游命令文档。未接入的 Linux 执行路线仍需用实际样例验证。

| 分类 | 数量 | 含义 |
| --- | ---: | --- |
| 已覆盖 | 2 | 现有外部工具可执行主要动作，输入和返回契约有所不同。 |
| 已有运行时，补适配 | 9 | 使用已固定的 GridCraft 0.10.0 或 PdfCraft 0.8.0 CLI，补 schema、执行映射或工作会话。 |
| 接入原生运行时 | 66 | 本地上游源码或随项目保存的上游文档提供原生路线。需要固定 Linux 构建、实现受限适配并验证行为。 |
| 接入媒体执行 | 4 | 使用 FilmCraft 或 EffectCraft 原生路线，并补齐媒体依赖、预览返回和长任务导出。 |
| 接入模型执行 | 3 | 需要模型调用、计费及生成结果导入对应项目。 |
| **合计** | **84** | 每条命令按主要接入工作归入一类。 |

## 逐项目清单

同名命令以项目区分。每个命令都列在对应分类中。

| 项目 | 数量 | 分类及命令 | 可复用实现和差距 |
| --- | ---: | --- | --- |
| PhotoCraft | 5 | **原生** `get_document_state`、`find_commands`、`describe_command`、`run_command`、`undo` | `photocraft-cli` 有 headless MCP、命令目录及脚本。需要将浏览器文档快照映射到服务端文件，并限定可发现及可执行的命令。验证分层 PSD 另存、图层 ID 和撤销。 |
| LightCraft | 4 | **原生** `get_photo_state`、`look_at_photo`、`set_develop`。**模型** `retouch_photo` | Headless `lightcraft-cli mcp` 提供目录检查、`get_develop`、`render_preview`、`set_develop`。用显式照片 ID 建立项目内状态。修图需要渲染源图、调用模型、把新图导入工作库。 |
| VectorCraft | 8 | **原生** `read_canvas`、`add_rectangle`、`add_ellipse`、`add_text`、`set_fill`、`move_object`、`set_text`、`undo` | Headless `vectorcraft-cli mcp` 可读文档、运行绘图命令及保存。适配时保留支持对象、文本与填充限制，验证可编辑文件另存。 |
| FigCraft | 6 | **原生** `read_canvas`、`set_text`、`set_fill`、`move_node`、`create_node`、`undo` | CLI 提供 headless 文档和节点编辑。接入需保留组件、自动布局、样式和协作相关限制，并验证 `.figcraft` 文件与字体。 |
| DesignCraft | 6 | **原生** `read_layout`、`set_text`、`move_frame`、`add_text`、`add_shape`、`undo` | CLI 支持 headless 检查、执行及保存布局。适配 spread/page 坐标、文本溢出、Smart Text Reflow 和字体。 |
| FilmCraft | 9 | **原生** `get_timeline_state`、`run_commands`、`find_effects`、`find_commands`、`describe_command`、`undo`。**媒体** `look_at_frame`、`export_video`。**模型** `generate_image` | 上游 README 记录原生命令分发及 headless MCP。需验证时间轴快照、命令过滤、部分失败与逐命令撤销。预览需返回真实画面，导出需解析项目引用的素材并把结果交回下载服务。生成的图片需放入时间轴。 |
| EffectCraft | 10 | **原生** `get_project_state`、`inspect_layer`、`run_commands`、`find_effects`、`find_commands`、`describe_command`、`undo`。**媒体** `look_at_frame`、`render_video`。**模型** `generate_image` | 上游 README 记录 headless MCP、属性树、命令和渲染。需验证批次原子性、按组撤销及属性路径。服务端返回预览图和渲染文件，验证合成素材与编码器。生成的图片需作为图层导入。 |
| SoundCraft | 7 | **原生** `read_session`、`set_volume`、`set_pan`、`set_mute`、`set_clip_gain`、`set_fade`、`undo` | CLI 提供 headless 会话。现有社区桥把五个写操作映射到 `mix.volume`、`mix.pan`、`mix.mute`、`clip.gain`、`edit.fades_create`。需接入音频素材和项目目录，保留轨道、自动化、片段和淡入淡出限制。 |
| WordCraft | 4 | **原生** `read_document`、`replace_paragraph`、`format_paragraph`、`undo` | Headless CLI 可打开和保存 DOCX、读取文本并执行编辑命令。需补正文段落定位、原文比对、段落范围和格式保护，并验证原生撤销。 |
| PdfCraft | 5 | **已覆盖** `rotate_pages`。**已有运行时** `read_pdf`、`replace_text_line`、`add_text`、`undo` | 外部 `edit_pdf` 已支持按页旋转，逆时针 90°用 270°表示。已固定 CLI 的 `doc_info` + `text_lines`、`text_edit`、`page_add_text`、`edit_undo` 可作为底层。当前 `inspect_file` 返回提取文本，需补精确行定位和可编辑性、原文与权限检查；新增文本还需遵守 CLI 字符集约束。 |
| GridCraft | 6 | **已覆盖** `set_cells`。**已有运行时** `get_workbook_state`、`read_range`、`read_cell`、`format_range`、`undo` | `edit_spreadsheet` 的 `set_values` 已支持值与公式，返回 XLSX。CLI 有 `info`、`cat --formulas`、`cell.get`、格式命令和 `edit.undo`。现有 `inspect_file` 返回工作簿信息与 CSV，尚需公式读回、单格格式和会话信息；格式当前仅开放粗体和数字格式。 |
| DeckCraft | 6 | **原生** `read_slides`、`set_text`、`set_notes`、`add_text`、`add_slide`、`undo` | Headless CLI 可检查幻灯片、执行命令和保存 PPTX。需映射文本形状、备注、插入位置及版式，并验证备注保真与原生撤销。 |
| CADCraft | 8 | **原生** `read_drawing`、`add_line`、`add_circle`、`add_rectangle`、`add_text`、`move_entity`、`set_text`、`undo` | Headless CLI 可检查图纸、执行几何命令和处理 DXF。需保留模型空间、图层、组、块及约束保护，明确坐标、单位和实体 ID。 |

## 共用后端工作

1. **文件与项目会话。** 现有上传只接受 PDF、XLSX、CSV，任务在独立进程中打开文件再另存。新增项目需明确可上传和输出的格式。关联字体、图片、音频、视频等素材用受限项目清单解析。跨调用保留项目身份与版本，拒绝过期快照上的写操作。
2. **原生执行。** 固定 Linux 二进制、依赖与校验和。每个项目定义允许的命令和参数，命令发现与执行使用同一份白名单。保持账户所有权、每任务隔离、路径约束、超时和输出限制。原生 stdio MCP 可在隔离执行进程内部复用。
3. **撤销与返回结果。** 12 个 `undo` 命令需要同一原生会话的历史，或实现明确记录上一版本的服务端版本操作。现有每任务重开输入的流程无法保留原生撤销历史。预览返回 MCP 图像，文件编辑或导出返回受控下载链接。媒体渲染需单独定义取消、超时和资源上限。
4. **模型与计费。** 三个图像操作分别是修图后导入相册、生成图后插入视频轨、生成图后插入合成图层。先确定远程调用的凭据、计费与媒体传输，再通过受限编辑操作导入生成结果。

## 可复核依据

- 外部工具及任务边界见 `mcp/server.mjs`、`mcp/schemas.mjs`、`mcp/jobs.mjs` 和 `deployment/native-runtimes.json`。
- GridCraft 和 PdfCraft 的已固定本地二进制提供 `gridcraft-cli commands --json`、`pdfcraft-cli tools`。当前端点的实际执行范围以服务器白名单为准。
- 原生候选依据工作区 `../upstream/<项目>/apps/<项目>-cli/` 与各项目的 `docs/mcp.md`。FilmCraft 和 EffectCraft 依据 `public/licenses/film/README.md` 和 `public/licenses/effect/README.md` 的上游文档，尚未实测这两者的 Linux CLI。
