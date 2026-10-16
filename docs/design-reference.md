# Visual reference

The three supplied screenshots define the resting appearance. Images 2 and 3 establish desktop chrome and navigation; image 1 establishes the goal outline. The textured background, outer frame, and cast shadow belong to the screenshots' presentation, so the application uses its native desktop window.

The subsequent sidebar revision replaces global navigation with an area-name dropdown and project folders. It removes the profile/organization button. Areas scope projects and notes; child notes expand beneath a project. New-note and new-folder Hugeicons appear on row hover or keyboard focus. The project detail card follows the later reference: title, note count, file path, and Edit project, with an optional pin action.

Framer Motion handles area changes, project and folder expansion, selection movement, dropdowns, and hover-card entry/exit. Motion uses the existing 200 ms curve and honors the system reduced-motion preference. Folder labels and icons toggle their contents together. Contents animate their height and opacity on both entry and exit, and closing groups become inert immediately. Autosave preserves a user's closed folders; opening a different note reveals its containing folders.

Sidebar dragging uses native HTML drag events. A faded source row, animated neutral insertion line, and outlined folder target provide feedback. Framer Motion animates the resulting sibling layout changes. Hovering a closed destination for 550 ms opens it, and edge scrolling keeps distant destinations reachable. Only sibling folders reorder; pages can also move to other folders and projects in the area. Keyboard reordering and a Move page dialog provide alternatives. Open folders use Hugeicons `Folder02Icon`; closed folders use `FolderClosedIcon`.

The implementation retains a compact sidebar, two quiet control bands, white content, neutral selection, and substantial unoccupied canvas. Text views have narrow columns; the board uses a horizontal grid and clips the next column. The assistant is a closed-by-default right panel.

| Token              | Logical value                                            |
| ------------------ | -------------------------------------------------------- |
| Canvas             | `#fff`                                                   |
| Sidebar and lanes  | `#f7f7f7`                                                |
| Selection          | `#ebebeb`                                                |
| Capsule            | `#f0f0f0`                                                |
| Font               | SF system sans on Mac; Segoe UI on Windows               |
| Heading            | 24/32, medium                                            |
| Task               | 16/24, regular; 36 px row rhythm                         |
| Navigation         | 13/20; 36 px pitch                                       |
| Metadata           | 11/16                                                    |
| Sidebar            | 320 px initially; 240–400 px resize                      |
| Titlebar / toolbar | 40 / 36 px                                               |
| Task reading width | 480 px                                                   |
| Board column / gap | 280 / 12 px                                              |
| Board lane         | 184 px minimum; 4 px inset                               |
| Radius             | 6 px tabs; 7 px nav; 8 px board/card                     |
| Icons              | Hugeicons Stroke Rounded, 1.5 stroke, typically 16–18 px |

`Target03Icon` supplies the concentric goal icon. `Note01Icon` also supplies the application icon; no separate hand-drawn interface icon family is mixed in.

The sample data reproduces the reference titles, task text, statuses, dates, parent grouping, and expanded sidebar branches. It also includes the two navigation goals from images 2–3, so the complete Goals view has eight entries rather than the six shown in image 1's alternate workspace. The Done column is initially hidden to retain the reference board composition.

Hover controls have keyboard-focus equivalents. Focus uses a quiet visible outline. Checkboxes and task titles perform separate actions. Long task text wraps. Reduced-motion media preferences disable transitions.

Visual verification must compare the content regions as well as the full canvas. A mostly blank screenshot must not be used to claim a low error score. Current captures are manual visual checks, not proof of the planned one-logical-pixel tolerance. Native font rendering and controls require separate platform baselines.
