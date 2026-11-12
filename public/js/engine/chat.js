// Chat rules shared by the client (for instant feedback) and the server (which enforces them).
export const CHAT_CHANNELS = ['global', 'zone', 'whisper'];
export const CHAT_LEVEL = 5;
export const CHAT_MAX_LEN = 200;
export const CHAT_RATE_MS = 2000;
export const CHAT_REPEAT_MS = 30000;

// Links are blocked: they're the usual way scams spread in game chat.
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|io|gg|xyz|ru|ly|me|co|dev|app|link|site|info|biz|tk|top|shop|store|online|live)\b)/i;

// Control and invisible formatting characters.
const range = (a, b) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
const INVISIBLE_RE = new RegExp(`[${range(0, 0x1f)}${String.fromCharCode(0x7f)}${range(0x200b, 0x200f)}${range(0x2028, 0x202e)}]`, 'g');

export function cleanChatText(raw) {
  const text = String(raw ?? '').replace(INVISIBLE_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, reason: 'Type a message.' };
  if (text.length > CHAT_MAX_LEN) return { ok: false, reason: `Messages can be up to ${CHAT_MAX_LEN} characters.` };
  if (LINK_RE.test(text)) return { ok: false, reason: 'Links are not allowed in chat.' };
  return { ok: true, text };
}

// last: the sender's most recent message { text, created_at } or null.
export function canSend(level, text, last, now = Date.now()) {
  if (level < CHAT_LEVEL) return { ok: false, reason: `Reach level ${CHAT_LEVEL} to chat.` };
  const clean = cleanChatText(text);
  if (!clean.ok) return clean;
  if (last) {
    const age = now - new Date(last.created_at).getTime();
    if (age < CHAT_RATE_MS) return { ok: false, reason: 'You are typing too fast. Wait a moment.' };
    if (age < CHAT_REPEAT_MS && last.text.toLowerCase() === clean.text.toLowerCase()) return { ok: false, reason: 'You just said that.' };
  }
  return clean;
}
