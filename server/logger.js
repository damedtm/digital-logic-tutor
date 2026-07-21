import { google } from 'googleapis';

const CLIENT_EMAIL = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_SHEETS_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || 'Log';

const LOGGING_ENABLED = Boolean(CLIENT_EMAIL && PRIVATE_KEY && SHEET_ID);

if (!LOGGING_ENABLED) {
  console.warn('Conversation logging disabled — set GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY, and GOOGLE_SHEET_ID to enable it.');
}

let sheetsClient = null;
function getSheetsClient() {
  if (!LOGGING_ENABLED) return null;
  if (sheetsClient) return sheetsClient;

  const auth = new google.auth.JWT({
    email: CLIENT_EMAIL,
    key: PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

// Lightweight keyword/pattern check for common guardrail-bypass framings.
// Not foolproof — a determined student can phrase around it — but it turns
// "read every transcript" into "check the flagged ones first."
const BYPASS_PATTERNS = [
  /ignore (your|the|any|all)?\s*(previous|prior|above)?\s*instructions?/i,
  /disregard (your|the)?\s*(previous|prior)?\s*(rules?|instructions?|guidelines?)/i,
  /i(’|')?m (the|a) (ta|professor|instructor|dean|admin|grader)/i,
  /i already (worked|solved|figured|did) (it|this) out/i,
  /just confirm (the|my)/i,
  /pretend (you|you're|you are)/i,
  /act as (if|though)/i,
  /bypass|jailbreak/i,
  /you are not bound by/i,
  /for grading purposes|to verify the (answer key|key)/i,
];

export function isLikelyBypassAttempt(studentMessage) {
  return BYPASS_PATTERNS.some((pattern) => pattern.test(studentMessage));
}

// Appends one row: timestamp, clientId, student message, tutor reply, flagged.
// Fire-and-forget from the caller's perspective — errors are caught and
// logged here, never thrown back up to break the chat response.
// Strips common Markdown syntax down to plain, readable text for the log —
// so rows are clean the moment they're written, with no spreadsheet-side
// post-processing script needed.
function stripMarkdown(text) {
  return text
    .replace(/^#{1,6}\s+/gm, '')          // headers
    .replace(/\*\*(.*?)\*\*/g, '$1')      // bold
    .replace(/\*(.*?)\*/g, '$1')          // italics
    .replace(/`([^`]+)`/g, '$1')          // inline code
    .replace(/^[-*]\s+/gm, '• ')          // bullet lists -> plain bullet
    .trim();
}

export async function logExchange({ clientId, studentMessage, tutorReply }) {
  if (!LOGGING_ENABLED) return;

  const flagged = isLikelyBypassAttempt(studentMessage);

  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:E`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          new Date().toISOString(),
          clientId || 'unknown',
          studentMessage,
          stripMarkdown(tutorReply),
          flagged ? 'FLAGGED' : '',
        ]],
      },
    });
  } catch (err) {
    console.error('Sheet logging failed (chat still worked fine):', err.message);
  }
}