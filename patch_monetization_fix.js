const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'apps/api/src/routes/monetization.route.ts');
let content = fs.readFileSync(file, 'utf-8');

content = content.replace(/}\);\n}\);\n\nconst reconcileSchema/g, '});\n\nconst reconcileSchema');
fs.writeFileSync(file, content);
