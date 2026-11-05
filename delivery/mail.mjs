// Send an email through Apple Mail on this Mac (D80): from the account Mail sends with by
// default, to one address in private/config/daily.json. No new service or key. The subject,
// body and address go in as arguments, never pasted into the script.
import { execFile } from 'node:child_process';

const SCRIPT = [
  'on run argv',
  'tell application "Mail"',
  'if (count of accounts) is 0 then error "Mail has no email account set up. Add your account in Mail → Settings → Accounts."',
  'set m to make new outgoing message with properties {subject:(item 1 of argv), content:(item 2 of argv), visible:false}',
  'tell m to make new to recipient at end of to recipients with properties {address:(item 3 of argv)}',
  'if (send m) is false then error "Mail did not accept the message for sending."',
  'end tell',
  'end run',
];

export function sendMail(to, subject, text, { exec = execFile } = {}) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to ?? ''))) return Promise.reject(new Error('Email send failed: weekly_email.to is not an email address.'));
  const args = SCRIPT.flatMap((l) => ['-e', l]).concat(['--', subject, text, to]);
  return new Promise((resolve, reject) => {
    exec('osascript', args, { timeout: 120000 }, (err, _o, stderr) => {
      if (err?.killed) reject(new Error('Email send failed: Mail did not answer within 2 min. If macOS is asking to let the app control Mail, click Allow (System Settings → Privacy & Security → Automation).'));
      else if (err) reject(new Error(`Email send failed: ${(stderr || `osascript exited with code ${err.code}`).trim()}`));
      else resolve();
    });
  });
}
