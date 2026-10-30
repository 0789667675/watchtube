const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'apps/web/src/components/layout/Layout.tsx');
let content = fs.readFileSync(file, 'utf-8');

if (!content.includes('BottomNav')) {
    content = content.replace("import { Header } from './Header';", "import { Header } from './Header';\nimport { BottomNav } from './BottomNav';");
    content = content.replace("      <main className=\"mx-auto\">", "      <main className=\"mx-auto pb-16 sm:pb-0\">");
    content = content.replace("      </main>\n    </div>", "      </main>\n      <BottomNav />\n    </div>");
    fs.writeFileSync(file, content);
}
