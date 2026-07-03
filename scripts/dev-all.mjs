// 어드민 dev 실행 시 웹플래너(5190)도 함께 구동한다.
// - 5190이 이미 떠 있으면 건너뛰고 어드민(vite)만 실행
// - 웹플래너 경로가 없으면 경고만 하고 어드민은 정상 실행
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';

const WEB_DIR = 'd:/unity/homeplanner3-web';
const WEB_PORT = 5190;

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

if (await portInUse(WEB_PORT)) {
  console.log(`[dev-all] 웹플래너가 이미 :${WEB_PORT} 에서 실행 중 — 건너뜀`);
} else if (!existsSync(WEB_DIR)) {
  console.warn(`[dev-all] 웹플래너 경로 없음(${WEB_DIR}) — 어드민만 실행`);
} else {
  console.log(`[dev-all] 웹플래너 dev 서버 시작: ${WEB_DIR} (:${WEB_PORT})`);
  const web = spawn('npm', ['run', 'dev'], { cwd: WEB_DIR, shell: true, stdio: 'inherit' });
  web.on('exit', (code) => console.log(`[dev-all] 웹플래너 종료 (code ${code})`));
}

const vite = spawn('npx', ['vite'], { shell: true, stdio: 'inherit' });
vite.on('exit', (code) => process.exit(code ?? 0));