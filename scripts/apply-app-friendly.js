import fs from 'fs';
import path from 'path';

const dir = process.cwd();
const files = fs.readdirSync(dir).filter(file => file.endsWith('.html') && !file.endsWith('-app.html'));
for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let updated = false;

  if (!content.includes('href="app.css"')) {
    content = content.replace(/<\/head>/i, '  <link rel="stylesheet" href="app.css">\n</head>');
    updated = true;
  }

  if (/\<body([^>]*?)\>/i.test(content) && !/\<body([^>]*?)class="[^"]*app-page[^"]*"/i.test(content)) {
    content = content.replace(/<body([^>]*)>/i, '<body$1 class="app-page">');
    updated = true;
  }

  if (updated) {
    fs.writeFileSync(filePath, content);
    console.log('updated', file);
  } else {
    console.log('skipped', file);
  }
}
