// Which layout the game uses, as one state that both the CSS and the code read:
//   #app[data-layout="mobile" | "wide" | "desktop"]
//   mobile   phones (the base layout)
//   wide     the Phase 2 two-column layout: tablets, small laptops, phones on their side
//   desktop  1200px+ (75em) with a mouse or trackpad (docs/desktop-scope.md)
// and, on desktop, where chat lives:
//   #app[data-chat="panel" | "drawer"]
//   panel    1280px+ (80em): a persistent chat panel in the side column (D-2)
//   drawer   the modal drawer, opened from the chat line (everywhere else)
//
// The desktop condition is in em, so a larger browser text size raises it. The usable width is
// also checked in rem, so text enlarged another way (a page or user style on the root) falls
// back too. The desktop layout's own type step (17-18px from 112.5em) can't trip that check:
// 1800px / 18px is still 100rem.
//
// The player can choose (landing L-2, docs/landing-scope.md Q12), saved in clickmonster.prefs:
//   auto     the rules above, exactly as before
//   desktop  the desktop layout whenever the usable width allows it (75em and 75rem), whatever
//            the pointer; otherwise Automatic, with `fallback` set. The choice itself is kept.
//   mobile   the phone column at any size
// The entrance (entry.js) explains the same Desktop rule; its numbers must match these
// (tests/entrance-files.test.mjs checks).
//
// The desktop layout needs a different reading order (hero bar, navigation, screen, actions,
// then the side column), so the regions are moved in the DOM, only when the layout changes.
// Focus and the caret are kept across the move.
const DESKTOP = '(min-width: 75em) and (hover: hover) and (pointer: fine)';
const WIDE = '(min-width: 900px), (orientation: landscape) and (max-height: 540px) and (min-width: 600px)';
const DESKTOP_MIN_REM = 75;
const DESKTOP_WIDTH = '(min-width: 75em)';
const CHAT_PANEL = '(min-width: 80em)';
const CHAT_PANEL_MIN_REM = 80;

const mqDesktop = matchMedia(DESKTOP);
const mqWide = matchMedia(WIDE);
const mqChat = matchMedia(CHAT_PANEL);
const mqDesktopWidth = matchMedia(DESKTOP_WIDTH);
export const LAYOUT_CHOICES = ['auto', 'desktop', 'mobile'];
let preference = 'auto';
const $ = (id) => document.getElementById(id);

function remWidth() {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return innerWidth / root;
}

// Automatic: by space and pointer, as before the picker existed.
function automatic() {
  if (mqDesktop.matches && remWidth() >= DESKTOP_MIN_REM) return 'desktop';
  if (mqWide.matches) return 'wide';
  return 'mobile';
}
// The layout for a choice, and whether a Desktop choice had to fall back for lack of room.
export function resolveLayout(choice = preference) {
  if (choice === 'mobile') return { layout: 'mobile', fallback: false };
  if (choice === 'desktop') {
    if (mqDesktopWidth.matches && remWidth() >= DESKTOP_MIN_REM) return { layout: 'desktop', fallback: false };
    return { layout: automatic(), fallback: true };
  }
  return { layout: automatic(), fallback: false };
}
export function currentLayout() { return resolveLayout().layout; }
// What the picker shows: the saved choice, the layout in use, and whether it fell back.
export function layoutStatus() { return { choice: preference, ...resolveLayout() }; }

let reapply = null;
// The player's choice. Unknown values count as Automatic. Applies at once if already watching.
export function setLayoutPreference(choice) {
  preference = LAYOUT_CHOICES.includes(choice) ? choice : 'auto';
  reapply?.();
}
// The persistent chat panel: desktop with room for it, by the same em and rem rules.
const chatPanel = (layout) => layout === 'desktop' && mqChat.matches && remWidth() >= CHAT_PANEL_MIN_REM;

// Region order for each layout. #side holds the desktop side column; elsewhere it is empty and
// hidden, and the chat line sits between the screen and the actions, as before.
function arrange(layout) {
  const app = $('app');
  const side = $('side');
  const chatbar = $('chatbar');
  const order = layout === 'desktop'
    ? ['top', 'nav', 'main', 'dock', 'side']
    : ['top', 'main', 'chatbar', 'dock', 'nav', 'side'];
  const inSide = layout === 'desktop';
  const now = [...app.children].map((e) => e.id).join(',');
  const want = order.join(',');
  if (now === want && (chatbar.parentElement === side) === inSide) return;

  const active = document.activeElement;
  const caret = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = $('main').scrollTop;
  if (inSide) side.append(chatbar);
  for (const id of order) app.append($(id));
  $('main').scrollTop = scroll;
  if (active && active !== document.body && active.isConnected && document.activeElement !== active) {
    active.focus({ preventScroll: true });
    if (caret) { try { active.setSelectionRange(...caret); } catch { /* not a text field */ } }
  }
}

let current = null;
// Sets the layout state and the region order; calls onChange(layout, panel) when the layout, the
// chat placement, the player's choice or its fallback changes (panel: true when the chat panel
// is mounted).
export function watchLayout(onChange) {
  const apply = () => {
    const { layout, fallback } = resolveLayout();
    const panel = chatPanel(layout);
    const key = `${layout}:${panel}:${preference}:${fallback}`;
    if (key === current) return;
    const layoutChanged = !current || !current.startsWith(`${layout}:`);
    current = key;
    $('app').dataset.layout = layout;
    $('app').dataset.chat = panel ? 'panel' : 'drawer';
    if (layoutChanged) arrange(layout);
    onChange(layout, panel);
  };
  mqDesktop.addEventListener('change', apply);
  mqWide.addEventListener('change', apply);
  mqChat.addEventListener('change', apply);
  mqDesktopWidth.addEventListener('change', apply);
  reapply = apply;
  addEventListener('resize', apply);
  // The root text size can change without a resize (a user or page style, zoom of text only):
  // a 1rem-wide probe reports it. The desktop type step changes it too, harmlessly (see above).
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;width:1rem;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  new ResizeObserver(apply).observe(probe);
  apply();
  return () => current;
}
