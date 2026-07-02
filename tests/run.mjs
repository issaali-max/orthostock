// شغّل كل حزم الاختبار بالتسلسل؛ أي فشل يوقف بنتيجة ≠ صفر
import { execFileSync } from 'child_process';
import fs from 'fs';
const files = fs.readdirSync('tests').filter((f) => f.endsWith('.test.mjs'));
for (const f of files) {
  console.log(`\n━━━ ${f} ━━━`);
  execFileSync('node', [`tests/${f}`], { stdio: 'inherit' });
}
console.log('\n✅ ALL SUITES GREEN');
