const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'apps/web/src/pages/WatchPage.tsx');
let content = fs.readFileSync(file, 'utf-8');

// The mobile watch page optimizations requested: Edge-to-edge player, horizontally scrollable action pills.
// They are largely already in place (`overflow-x-auto pb-2 sm:pb-0`, etc), but we will adjust padding to make player edge-to-edge.

content = content.replace('max-w-[1800px] mx-auto p-4 md:p-6 lg:flex lg:gap-6', 'max-w-[1800px] mx-auto sm:p-4 md:p-6 lg:flex lg:gap-6');
content = content.replace('<h1 className="text-xl md:text-2xl font-bold font-display mt-4">', '<div className="px-4 sm:px-0"><h1 className="text-xl md:text-2xl font-bold font-display mt-4">');

// Wrap everything from h1 down in padding div for mobile
content = content.replace('      <div className="lg:w-[30%] xl:w-[25%] mt-6 lg:mt-0">', '      </div><div className="px-4 sm:px-0 lg:w-[30%] xl:w-[25%] mt-6 lg:mt-0">');

fs.writeFileSync(file, content);
