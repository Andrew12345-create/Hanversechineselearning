import fs from 'fs';
import path from 'path';

const files = ['index.html','login.html','signup.html','learn.html','practice.html','profile.html','settings.html','notifications.html','hsk1.html','yct1.html'];
for (const file of files) {
  const src = path.join(process.cwd(), file);
  const dst = path.join(process.cwd(), file.replace(/\.html$/, '-app.html'));
  const content = fs.readFileSync(src, 'utf8');
  fs.writeFileSync(dst, content);
  console.log('created', dst);
}
