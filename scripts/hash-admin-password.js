import crypto from 'node:crypto';
import { emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';

if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
  throw new Error('Execute este comando em um terminal interativo.');
}

function readSecret(prompt) {
  stdout.write(prompt);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let secret = '';
    const finish = (error) => {
      stdin.removeListener('keypress', onKeypress);
      stdin.setRawMode(false);
      stdout.write('\n');
      error ? reject(error) : resolve(secret);
    };
    const onKeypress = (character, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('Operação cancelada.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { secret = secret.slice(0, -1); return; }
      if (character && !key.ctrl && !key.meta && character >= ' ') secret += character;
    };
    stdin.on('keypress', onKeypress);
  });
}

const password = await readSecret('Senha administrativa (mínimo 14 caracteres; entrada oculta): ');
if (password.length < 14 || password.length > 256) throw new Error('Use uma senha de 14 a 256 caracteres.');
const salt = crypto.randomBytes(16).toString('base64url');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
console.log('\nAdicione ao .env (não compartilhe nem versione este arquivo):');
console.log(`ADMIN_PASSWORD_SALT=${salt}`);
console.log(`ADMIN_PASSWORD_HASH=${hash}`);
