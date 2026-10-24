// Transactional email over Resend's HTTP API (no SDK). Without RESEND_API_KEY (local dev) the message is logged,
// so sign-in links show up in the `wrangler dev` terminal.

const API = 'https://api.resend.com/emails'

/**
 * @param {any} env
 * @param {{ to: string, subject: string, text: string }} msg
 */
export async function sendEmail(env, { to, subject, text }) {
  if (!env.RESEND_API_KEY) return console.log(`[email to ${to}] ${subject}\n${text}`)
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, text }),
  })
  if (!res.ok) throw new Error(`Email failed: ${res.status} ${await res.text()}`)
}
