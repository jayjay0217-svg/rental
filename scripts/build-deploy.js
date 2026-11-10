/**
 * 붙여넣기 설치용 파일 2개를 만듭니다:  node scripts/build-deploy.js
 *   deploy/Code.gs     ← src/Logic.js + src/Data2026Fall.js + src/Code.js
 *   deploy/Index.html  ← src/Index.html 에 Styles·Client를 끼워 넣은 것
 * Apps Script 편집기에는 이 두 파일만 붙여 넣으면 됩니다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');

function build() {
  const head = '// 자동 생성 파일입니다. 고칠 때는 src/ 를 고치고 node scripts/build-deploy.js 를 실행하세요.\n';
  const code = head + ['Logic.js', 'Data2026Fall.js', 'Code.js']
    .map((f) => '\n// ===== src/' + f + ' =====\n' + src(f)).join('');
  const index = src('Index.html').replace(/<\?!=\s*include\('(\w+)'\);\s*\?>/g, (_, n) => src(n + '.html'));
  return { 'Code.gs': code, 'Index.html': index };
}

if (require.main === module) {
  const out = build();
  for (const [f, text] of Object.entries(out)) fs.writeFileSync(path.join(ROOT, 'deploy', f), text);
  console.log('deploy/Code.gs, deploy/Index.html 생성');
}

module.exports = { build };
