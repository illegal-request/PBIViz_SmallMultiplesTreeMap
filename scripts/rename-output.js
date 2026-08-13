const fs   = require('fs');
const path = require('path');
const pkg  = require('../pbiviz.json');

const guid    = pkg.visual.guid;
const version = pkg.visual.version;
const distDir = path.join(__dirname, '..', 'dist');

const src = path.join(distDir, `${guid}.${version}.pbiviz`);
const dst = path.join(distDir, `PBIVizSmallMultiplesTreeMap_${version}.pbiviz`);

if (fs.existsSync(src)) {
  if (fs.existsSync(dst)) fs.unlinkSync(dst);
  fs.renameSync(src, dst);
  console.log(`Packaged: dist/PBIVizSmallMultiplesTreeMap_${version}.pbiviz`);
} else {
  console.warn(`rename-output: source file not found: ${path.basename(src)}`);
}
