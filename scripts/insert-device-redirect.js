import fs from 'fs';
import path from 'path';

const dir = process.cwd();
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html') && !f.endsWith('-app.html'));
for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('device-redirect.js')) {
    content = content.replace(/<\/head>/i, '  <script src="device-redirect.js"></script>\n</head>');
    fs.writeFileSync(filePath, content);
    console.log('inserted redirect script into', file);
  } else {
    console.log('already contains redirect script:', file);
  }
}
