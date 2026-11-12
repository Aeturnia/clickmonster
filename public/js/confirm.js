// Accessible confirmations on a native <dialog>, replacing window.confirm() and prompt().
// Shared by the game, the chat drawer and the admin console.
//
//   const ok = await ask({
//     title: 'Delete Bartholomew Thorne?',
//     points: ['Your gear, gems, gold and bank are deleted with them.', 'This cannot be undone.'],
//     confirm: 'Delete forever', cancel: 'Keep my hero',
//     tone: 'danger',                 // 'danger' (focus starts on Cancel) or 'normal' (on the confirm button)
//     typeToConfirm: 'Bartholomew Thorne', // optional: confirm stays disabled until this is typed
//     input: { label: 'Reason (optional)', maxlength: 200 }, // optional free text, returned as value
//   });
//   if (!ok) return;      // null when cancelled (button, Escape or a tap outside)
//   ok.value              // the typed text, when `input` was given
//
// Confirmation rules (which actions ask, and how) are documented in docs/ui-phase-3-report.md.
// The server keeps its own checks; a confirmation is only a chance to change your mind.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const closers = [];
let dlg = null;
let pending = null; // { resolve, opener }

/** Called after the dialog closes (the game re-homes its toast and alerts). */
export function onConfirmClose(fn) { closers.push(fn); }

function ensure() {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'confirm';
  dlg.className = 'confirm';
  dlg.setAttribute('role', 'alertdialog');
  dlg.setAttribute('aria-labelledby', 'confirm-title');
  dlg.setAttribute('aria-describedby', 'confirm-body');
  document.body.appendChild(dlg);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
  // A tap on the backdrop (outside the card) cancels.
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) { finish(null); return; }
    const b = e.target.closest('[data-r]');
    if (!b || b.disabled) return;
    if (b.dataset.r === 'cancel') finish(null);
  });
  dlg.addEventListener('submit', (e) => {
    e.preventDefault();
    const ok = dlg.querySelector('[data-r="ok"]');
    if (ok.disabled) return;
    const input = dlg.querySelector('#confirm-input');
    finish({ value: input && !input.dataset.match ? input.value.trim() : undefined });
  });
  dlg.addEventListener('input', () => {
    const input = dlg.querySelector('#confirm-input');
    if (!input?.dataset.match) return;
    const ok = dlg.querySelector('[data-r="ok"]');
    ok.disabled = input.value.trim().toLowerCase() !== input.dataset.match.toLowerCase();
  });
  return dlg;
}

function finish(result) {
  if (!pending) return;
  const { resolve, opener } = pending;
  pending = null;
  if (dlg.open) dlg.close();
  dlg.innerHTML = '';
  if (opener && opener.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
  for (const fn of closers) { try { fn(); } catch { /* keep closing */ } }
  resolve(result);
}

export function ask({ title, lead = '', points = [], confirm = 'Confirm', cancel = 'Cancel', tone = 'danger', typeToConfirm = null, input = null } = {}) {
  ensure();
  if (pending) finish(null); // only one question at a time
  const opener = document.activeElement;
  const field = typeToConfirm
    ? `<label class="field confirm-field">Type <b>${esc(typeToConfirm)}</b> to confirm
        <input id="confirm-input" autocomplete="off" autocapitalize="off" spellcheck="false" data-match="${esc(typeToConfirm)}" aria-describedby="confirm-body"></label>`
    : input
      ? `<label class="field confirm-field">${esc(input.label)}
          <input id="confirm-input" autocomplete="off" maxlength="${Number(input.maxlength) || 200}" placeholder="${esc(input.placeholder || '')}"></label>`
      : '';
  dlg.dataset.tone = tone;
  dlg.innerHTML = `<form class="confirm-card" novalidate>
      <h2 id="confirm-title">${esc(title)}</h2>
      <div id="confirm-body">
        ${lead ? `<p>${esc(lead)}</p>` : ''}
        ${points.length ? `<ul class="consequences">${points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      </div>
      ${field}
      <div class="confirm-actions">
        <button type="button" class="btn" data-r="cancel">${esc(cancel)}</button>
        <button type="submit" class="btn ${tone === 'danger' ? 'danger-solid' : 'primary'}" data-r="ok"${typeToConfirm ? ' disabled' : ''}>${esc(confirm)}</button>
      </div>
    </form>`;
  return new Promise((resolve) => {
    pending = { resolve, opener };
    dlg.showModal();
    const first = dlg.querySelector('#confirm-input') || dlg.querySelector(tone === 'danger' ? '[data-r="cancel"]' : '[data-r="ok"]');
    first.focus();
  });
}

/** True while a confirmation is showing (keyboard shortcuts elsewhere should stand down). */
export const isAsking = () => !!pending;
