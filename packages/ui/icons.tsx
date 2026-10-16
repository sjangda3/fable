import { HugeiconsIcon } from "@hugeicons/react";
import {
  Layers01Icon,
  Target03Icon,
  DashboardSquare01Icon,
  CheckmarkSquare02Icon,
  CheckmarkCircle02Icon,
  ChartLineData01Icon,
  FolderClosedIcon,
  Search01Icon,
  Bookmark01Icon,
  FileAddIcon,
  FolderAddIcon,
  Folder02Icon,
  PinIcon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Add01Icon,
  Cancel01Icon,
  Settings01Icon,
  HelpCircleIcon,
  Clock01Icon,
  CircleIcon,
  Flag02Icon,
  Calendar03Icon,
  DragDropVerticalIcon,
  MoreHorizontalIcon,
  Note01Icon,
  File01Icon,
  CloudIcon,
  AiChat02Icon,
  ArrowUp01Icon,
  Tick02Icon,
  Attachment01Icon,
  CodeIcon,
  LayoutThreeColumnIcon,
  ArrowReloadHorizontalIcon,
  ComputerIcon,
  LockPasswordIcon,
  Copy01Icon,
  Delete02Icon,
  PencilEdit01Icon,
  ViewIcon,
  KeyboardIcon,
} from "@hugeicons/core-free-icons";
const icons = {
  areas: Layers01Icon,
  goals: Target03Icon,
  projects: DashboardSquare01Icon,
  tasks: CheckmarkSquare02Icon,
  completed: CheckmarkCircle02Icon,
  insights: ChartLineData01Icon,
  folder: FolderClosedIcon,
  search: Search01Icon,
  bookmark: Bookmark01Icon,
  fileAdd: FileAddIcon,
  folderAdd: FolderAddIcon,
  folderOpen: Folder02Icon,
  pin: PinIcon,
  sidebar: SidebarLeft01Icon,
  panel: SidebarRight01Icon,
  down: ArrowDown01Icon,
  left: ArrowLeft01Icon,
  right: ArrowRight01Icon,
  add: Add01Icon,
  close: Cancel01Icon,
  settings: Settings01Icon,
  help: HelpCircleIcon,
  waiting: Clock01Icon,
  todo: CircleIcon,
  ready: CircleIcon,
  doing: ArrowRight01Icon,
  done: CheckmarkCircle02Icon,
  flag: Flag02Icon,
  calendar: Calendar03Icon,
  drag: DragDropVerticalIcon,
  more: MoreHorizontalIcon,
  note: Note01Icon,
  page: File01Icon,
  cloud: CloudIcon,
  ai: AiChat02Icon,
  up: ArrowUp01Icon,
  check: Tick02Icon,
  attachment: Attachment01Icon,
  code: CodeIcon,
  sort: LayoutThreeColumnIcon,
  refresh: ArrowReloadHorizontalIcon,
  computer: ComputerIcon,
  lock: LockPasswordIcon,
  copy: Copy01Icon,
  trash: Delete02Icon,
  edit: PencilEdit01Icon,
  view: ViewIcon,
  keyboard: KeyboardIcon,
};
const library = {
  ...icons,
  area: Layers01Icon,
  goal: Target03Icon,
  project: DashboardSquare01Icon,
  insight: ChartLineData01Icon,
  conversation: AiChat02Icon,
};
export type IconName = keyof typeof library;
export function Icon({
  name,
  size = 18,
  className = "",
  strokeWidth = 1.5,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <HugeiconsIcon
      icon={library[name] ?? Note01Icon}
      size={size}
      strokeWidth={strokeWidth}
      color="currentColor"
      className={`icon ${className}`}
      aria-hidden="true"
    />
  );
}
