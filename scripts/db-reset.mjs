import readline from 'node:readline';
import { spawn } from 'node:child_process';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Type "yes" to reset the database (this will DROP all data): ', (answer) => {
  rl.close();
  if (answer !== 'yes') {
    // eslint-disable-next-line no-console -- CLI feedback
    console.log('Aborted.');
    process.exit(0);
  }

  const child = spawn('npx', ['prisma', 'migrate', 'reset'], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
});
