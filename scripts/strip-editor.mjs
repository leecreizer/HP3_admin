// main 배포용 — 에디터 메뉴(파츠 모델러/조립)를 노출에서 제거한다.
// editor-version에서 main으로 전체 파일 동기화 후 실행(멱등). 파츠/조립 코드 파일은 남기고 메뉴만 제거.
import { readFileSync, writeFileSync } from 'node:fs';

function edit(path, fn) {
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  if (before !== after) { writeFileSync(path, after); console.log(`[strip-editor] 수정: ${path}`); }
  else console.log(`[strip-editor] 변경 없음: ${path}`);
}

edit('src/config.ts', (s) => s
  // mainMenu 에디터 항목
  .replace(/\n\s*\{ key: 'editor', label: '에디터', visible: true \},/g, '')
  // DEFAULT_SUBMENUS.editor 블록
  .replace(/\n\s*editor:\s*\[[\s\S]*?\n\s*\],/g, '')
  // 키 배열/등급에서 editor·parts·assembly 제거
  .replace(/'products', 'editor', 'parts', 'assembly', 'design', 'settings',/g, "'products', 'design', 'settings',")
  .replace(/'products', 'editor', 'parts', 'assembly', 'design'\], builtin/g, "'products', 'design'], builtin")
);

edit('src/App.tsx', (s) => s
  .replace(/\nimport \{ PartEditor \} from '\.\/pages\/PartEditor';/g, '')
  .replace(/\nimport \{ AssemblyEditor \} from '\.\/pages\/AssemblyEditor';/g, '')
  // 라우팅 case (editor/parts/assembly) — case 'editor'부터 assembly break;까지
  .replace(/\n[ \t]*case 'editor':[\s\S]*?\n[ \t]*case 'assembly':[\s\S]*?\n[ \t]*break;/g, '')
);

console.log('[strip-editor] 완료');
