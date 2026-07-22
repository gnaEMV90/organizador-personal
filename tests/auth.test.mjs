import test from 'node:test';
import assert from 'node:assert/strict';
import { publicUser, validatePasswordPolicy } from '../functions/_lib/auth.js';

test('la política de contraseñas exige longitud, letras y números', () => {
  assert.match(validatePasswordPolicy('corta1'), /10 caracteres/);
  assert.match(validatePasswordPolicy('solamentetexto'), /letras y números/);
  assert.equal(validatePasswordPolicy('Planorha2026'), '');
});

test('una prueba vigente habilita acceso completo y calcula días restantes', () => {
  const user = publicUser({
    id: 'u1', name: 'Prueba', email: 'prueba@example.com', role: 'user', status: 'trialing',
    email_verified_at: new Date().toISOString(), trial_started_at: new Date().toISOString(),
    trial_ends_at: new Date(Date.now() + 6.5 * 86_400_000).toISOString(), password_hash: 'hash'
  });
  assert.equal(user.accessMode, 'full');
  assert.equal(user.trialDaysRemaining, 7);
  assert.equal(user.hasPassword, true);
});

test('una prueba vencida queda en solo lectura sin perder identidad', () => {
  const user = publicUser({
    id: 'u2', name: 'Vencida', email: 'vencida@example.com', role: 'user', status: 'trial_expired',
    email_verified_at: new Date().toISOString(), trial_started_at: new Date().toISOString(),
    trial_ends_at: new Date(Date.now() - 1000).toISOString(), password_hash: 'hash'
  });
  assert.equal(user.accessMode, 'read_only');
  assert.equal(user.trialDaysRemaining, 0);
  assert.equal(user.email, 'vencida@example.com');
});

test('el rol administrador conserva acceso completo mientras la cuenta esté activa', () => {
  const user = publicUser({ id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'admin', status: 'active' });
  assert.equal(user.accessMode, 'full');
});
