const GMAIL_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

function gmailConfigured(env) {
  return Boolean(
    env.AUTH_EMAIL_PROVIDER === 'gmail' &&
    env.AUTH_FROM_EMAIL &&
    env.GMAIL_CLIENT_ID &&
    env.GMAIL_CLIENT_SECRET &&
    env.GMAIL_REFRESH_TOKEN
  );
}

function adapterConfigured(env) {
  return Boolean(env.AUTH_EMAIL_ENDPOINT && env.AUTH_FROM_EMAIL);
}

export function authEmailConfigured(env) {
  return gmailConfigured(env) || adapterConfigured(env);
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function utf8Base64(value) {
  return bytesToBase64(new TextEncoder().encode(String(value || '')));
}

function base64Url(value) {
  return utf8Base64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodedHeader(value) {
  return `=?UTF-8?B?${utf8Base64(value)}?=`;
}

function buildMimeMessage({ from, to, subject, text, html }) {
  const boundary = `planorha_${crypto.randomUUID().replace(/-/g, '')}`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    utf8Base64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    utf8Base64(html),
    `--${boundary}--`,
    ''
  ].join('\r\n');
}

async function gmailAccessToken(env) {
  const response = await fetch(GMAIL_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Planorha Gmail OAuth:', response.status, detail.slice(0, 300));
    return null;
  }

  const payload = await response.json();
  return String(payload.access_token || '') || null;
}

async function sendWithGmail(env, message) {
  const accessToken = await gmailAccessToken(env);
  if (!accessToken) return { sent: false, configured: true, reason: 'gmail_oauth_failed' };

  const raw = base64Url(buildMimeMessage({
    from: env.AUTH_FROM_EMAIL,
    ...message
  }));

  const response = await fetch(GMAIL_SEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Planorha Gmail send:', response.status, detail.slice(0, 500));
    return { sent: false, configured: true, reason: `gmail_http_${response.status}` };
  }

  return { sent: true, configured: true, provider: 'gmail' };
}

async function sendWithAdapter(env, message) {
  const response = await fetch(env.AUTH_EMAIL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.AUTH_EMAIL_TOKEN ? { Authorization: `Bearer ${env.AUTH_EMAIL_TOKEN}` } : {})
    },
    body: JSON.stringify({
      from: env.AUTH_FROM_EMAIL,
      ...message
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Planorha email:', response.status, detail.slice(0, 500));
    return { sent: false, configured: true, reason: `http_${response.status}` };
  }

  return { sent: true, configured: true, provider: 'adapter' };
}

export async function sendAuthEmail(env, message) {
  if (gmailConfigured(env)) return sendWithGmail(env, message);
  if (adapterConfigured(env)) return sendWithAdapter(env, message);
  return { sent: false, configured: false, reason: 'not_configured' };
}

export function verificationEmail({ name, verificationUrl }) {
  const safeName = String(name || '');
  return {
    subject: 'Verificá tu cuenta de Planorha',
    text: `Hola ${safeName}. Confirmá tu correo y activá tus 7 días de prueba: ${verificationUrl}`,
    html: `<p>Hola ${safeName}.</p><p>Confirmá tu correo para activar tus <strong>7 días de prueba completa</strong> de Planorha.</p><p><a href="${verificationUrl}">Verificar mi cuenta</a></p><p>Este enlace vence en 24 horas.</p>`
  };
}

export function resetPasswordEmail({ name, resetUrl }) {
  const safeName = String(name || '');
  return {
    subject: 'Restablecé tu contraseña de Planorha',
    text: `Hola ${safeName}. Usá este enlace para elegir una nueva contraseña: ${resetUrl}`,
    html: `<p>Hola ${safeName}.</p><p>Recibimos una solicitud para cambiar tu contraseña de Planorha.</p><p><a href="${resetUrl}">Elegir una nueva contraseña</a></p><p>Este enlace vence en 60 minutos. Si no lo pediste, ignorá este correo.</p>`
  };
}
