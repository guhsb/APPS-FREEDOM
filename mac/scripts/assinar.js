// Assinatura "ad-hoc" (sem certificado pago da Apple): o Mac com chip Apple exige o app assinado para abrir.
// Roda depois de montar o app universal, antes de gerar o .dmg e o .zip.
const { execFileSync } = require('child_process');
const path = require('path');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  if (ctx.arch !== 4) return;            // 4 = universal (as versões Intel/ARM separadas são juntadas antes)
  const app = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--verbose=2', app], { stdio: 'inherit' });
};
