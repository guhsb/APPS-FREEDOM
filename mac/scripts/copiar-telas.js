// Copia as telas do app (as mesmas do Android e do Windows) para mac/www antes de montar.
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..', '..'), www = path.join(__dirname, '..', 'www');
fs.rmSync(www, { recursive: true, force: true }); fs.mkdirSync(www, { recursive: true });
for (const d of ['comum/src/main/assets', 'app/src/main/assets']) {
  const pasta = path.join(raiz, d);
  for (const f of fs.readdirSync(pasta)) fs.copyFileSync(path.join(pasta, f), path.join(www, f));
}
console.log('telas copiadas:', fs.readdirSync(www).length);
