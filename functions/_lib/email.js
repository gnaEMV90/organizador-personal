export function authEmailConfigured(env) {
  return Boolean(env.AUTH_EMAIL_ENDPOINT && env.AUTH_FROM_EMAIL);
}

export async function sendAuthEmail(env, { to, subject, text, html }) {
  if (!authEmailConfigured(env)) {
    return { sent: false, configured: false, reason: 'not_configured' };
  }

  const response = await fetch(env.AUTH_EMAIL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.AUTH_EMAIL_TOKEN ? { Authorization: `Bearer ${env.AUTH_EMAIL_TOKEN}` } : {})
    },
    body: JSON.stringify({
      from: env.AUTH_FROM_EMAIL,
      to,
      subject,
      text,
      html
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Planorha email:', response.status, detail.slice(0, 500));
    return { sent: false, configured: true, reason: `http_${response.status}` };
  }

  return { sent: true, configured: true };
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
