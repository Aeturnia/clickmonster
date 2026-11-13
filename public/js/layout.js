// Which layout the game uses, as one state that both the CSS and the code read:
//   #app[data-layout="mobile" | "wide" | "desktop"]
//   mobile   phones (the base layout)
//   wide     the Phase 2 two-column layout: tablets, small laptops, phones on their side
//   desktop  1200px+ (75em) with a mouse or trackpad (docs/desktop-scope.md)
//
// The desktop condition is in em, so a larger browser text size raises it. The usable width is
// also checked in rem, so text enlarged another way (a page or user style on the root) falls
// back too. The desktop layout's own type step (17-18px from 112.5em) can't trip that check:
// 1800px / 18px is still 100rem.
//
// The desktop layout needs a different reading order (hero bar, navigation, screen, actions,
// then the side column), so the regions are moved in the DOM, only when the layout changes.
// Focus and the caret are kept across the move.
const DESKTOP = '(min-width: 75em) and (hover: hover) and (pointer: fine)';
const WIDE = '(min-width: 900px), (orientation: landscape) and (max-height: 540px) and (min-width: 600px)';
const DESKTOP_MIN_REM = 75;

const mqDesktop = matchMedia(DESKTOP);
const mqWide = matchMedia(WIDE);
const $ = (id) => document.getElementById(id);

function remWidth() {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return innerWidth / root;
}

export function currentLayout() {
  if (mqDesktop.matches && remWidth() >= DESKTOP_MIN_REM) return 'desktop';
  if (mqWide.matches) return 'wide';
  return 'mobile';
}

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
// Sets the layout state and the region order; calls onChange(layout) when it changes.
export function watchLayout(onChange) {
  const apply = () => {
    const layout = currentLayout();
    if (layout === current) return;
    current = layout;
    $('app').dataset.layout = layout;
    arrange(layout);
    onChange(layout);
  };
  mqDesktop.addEventListener('change', apply);
  mqWide.addEventListener('change', apply);
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
