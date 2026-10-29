/* Freedom · exporta a conversa do chamado em PDF: cada mensagem com nome e horário, com quebra de página.
   Os anexos só aparecem listados no fim (nome, tamanho, quem enviou e quando), sem o conteúdo. */
(function () {
  var MARGEM = 44, LARG = 595.28, ALT = 841.89, UTIL = LARG - MARGEM * 2;
  var NAVY = [0.059, 0.106, 0.239], TX2 = [0.294, 0.345, 0.459], TX3 = [0.482, 0.529, 0.62], ROSA = [0.878, 0.271, 0.498],
      VERDE = [0.055, 0.624, 0.431], LN = [0.882, 0.906, 0.937], SF2 = [0.965, 0.973, 0.988], ROSA_S = [0.988, 0.925, 0.949], VERDE_S = [0.91, 0.973, 0.945];

  function carregarLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    return new Promise(function (ok, erro) {
      var s = document.createElement('script'); s.src = 'pdf-lib.min.js';
      s.onload = function () { window.PDFLib ? ok(window.PDFLib) : erro(new Error('PDF indisponível')); };
      s.onerror = function () { erro(new Error('Não consegui carregar o gerador de PDF')); };
      document.head.appendChild(s);
    });
  }

  function dataHora(s) {
    var d = s ? new Date(s) : null; if (!d || isNaN(d)) return '';
    var p = function (n) { return ('0' + n).slice(-2); };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function tamanho(b) { b = +b || 0; return b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }

  window.exportarConversaPdf = function (d, anexos, avisar) {
    avisar = avisar || function () { };
    var t = (d && d.ticket) || {};
    return carregarLib().then(function (L) {
      return L.PDFDocument.create().then(function (doc) {
        return Promise.all([doc.embedFont(L.StandardFonts.Helvetica), doc.embedFont(L.StandardFonts.HelveticaBold), doc.embedFont(L.StandardFonts.HelveticaOblique)]).then(function (fs) {
          var F1 = fs[0], FB = fs[1], FI = fs[2], cor = function (c) { return L.rgb(c[0], c[1], c[2]); };
          // texto que a fonte do PDF não tem (emoji, setas…) vira algo parecido
          var cache = {}, TROCA = { '→': '->', '←': '<-', '★': '*', '☆': '-', '✓': 'v', '✔': 'v', '•': '·', '\t': '  ' };
          function limpo(s, f) {
            s = String(s == null ? '' : s).replace(/\r/g, ''); var o = '';
            for (var i = 0; i < s.length; i++) {
              var ch = s[i]; if (ch === '\n') { o += ch; continue; }
              var k = ch + (f === FB ? 'b' : f === FI ? 'i' : 'n');
              if (cache[k] == null) { try { f.widthOfTextAtSize(ch, 10); cache[k] = ch; } catch (e) { cache[k] = TROCA[ch] != null ? TROCA[ch] : (/[\uD800-\uDFFF]/.test(ch) ? '' : '?'); } }
              o += cache[k];
            }
            return o;
          }
          function quebrar(s, f, tam, max) {
            var out = [];
            limpo(s, f).split('\n').forEach(function (par) {
              var pal = par.split(' '), lin = '';
              pal.forEach(function (p) {
                while (f.widthOfTextAtSize(p, tam) > max && p.length > 1) {   // palavra comprida (link): corta
                  var k = p.length; while (k > 1 && f.widthOfTextAtSize(p.slice(0, k), tam) > max) k--;
                  if (lin) { out.push(lin); lin = ''; } out.push(p.slice(0, k)); p = p.slice(k);
                }
                var teste = lin ? lin + ' ' + p : p;
                if (f.widthOfTextAtSize(teste, tam) > max && lin) { out.push(lin); lin = p; } else lin = teste;
              });
              out.push(lin);
            });
            return out;
          }
          var pg = null, y = 0;
          function nova() { pg = doc.addPage([LARG, ALT]); y = ALT - MARGEM; }
          function espaco(h) { if (!pg || y - h < MARGEM + 24) nova(); }
          function txt(s, x, yy, f, tam, c) { pg.drawText(limpo(s, f), { x: x, y: yy, size: tam, font: f, color: cor(c || NAVY) }); }

          // ---- cabeçalho ----
          nova();
          txt('Chamado ' + (t.protocol || ('#' + (t.id || ''))), MARGEM, y - 18, FB, 19, NAVY); y -= 26;
          quebrar(t.title || '', F1, 12.5, UTIL).forEach(function (l) { txt(l, MARGEM, y - 14, F1, 12.5, TX2); y -= 17; });
          y -= 6;
          var info = [['Solicitante', d.requester_name], ['Responsável', d.assignee_name || 'Não atribuído'], ['Setor', d.queue_name],
            ['Status', (window.stLabel ? stLabel(t.status) : t.status)], ['Prioridade', (window.PRIO && PRIO[t.priority] ? PRIO[t.priority][0] : t.priority)], ['Aberto em', dataHora(t.created_at)]];
          for (var i = 0; i < info.length; i += 3) {
            for (var k = 0; k < 3 && i + k < info.length; k++) {
              var x = MARGEM + k * (UTIL / 3);
              txt(info[i + k][0], x, y - 10, F1, 8.5, TX3);
              txt(quebrar(info[i + k][1] || '—', FB, 10, UTIL / 3 - 10)[0], x, y - 24, FB, 10, NAVY);
            }
            y -= 34;
          }
          pg.drawRectangle({ x: MARGEM, y: y - 4, width: UTIL, height: 1.4, color: cor(ROSA) }); y -= 20;
          txt('CONVERSA', MARGEM, y - 10, FB, 9.5, TX2); y -= 22;

          // ---- conversa ----
          var sol = window.solucaoProposta ? solucaoProposta(d) : {}, idSol = sol && sol.msg ? sol.msg.id : null;
          (d.items || []).forEach(function (it) {
            var a = it.actor || {}, quem = a.name || 'Sistema', quando = dataHora(it.created_at);
            if (it.type === 'EVENT') {
              var ev = window.textoEvento ? textoEvento(it) : ['', 'evento'];
              var lin = quebrar(quem + ' ' + ev[1] + (quando ? ' · ' + quando : ''), FI, 8.5, UTIL - 20);
              espaco(lin.length * 11 + 6);
              lin.forEach(function (l) { txt(l, MARGEM + 10, y - 9, FI, 8.5, TX3); y -= 11; }); y -= 5;
              return;
            }
            var eu = !!a.is_current_user, ehSol = idSol != null && it.id === idSol;
            var tag = ehSol ? 'solução' : it.type === 'OPENING' ? 'abriu o chamado' : (a.context === 'REQUESTER' ? 'solicitante' : '');
            var corpo = quebrar(String(it.body || '').trim() || '(sem texto)', F1, 10.5, UTIL - 24);
            var h = 18 + corpo.length * 14 + 12, iniciou = false;
            // mensagem longa: vai em pedaços (cabeçalho repete com "continuação")
            var resto = corpo.slice();
            while (resto.length) {
              var cabe = pg ? Math.floor((y - MARGEM - 24 - 30) / 14) : 0;
              if (!pg || cabe < 1 || (cabe < 2 && resto.length > 1)) { nova(); cabe = Math.floor((y - MARGEM - 24 - 30) / 14); }
              if (!iniciou && 18 + resto.length * 14 + 12 > y - MARGEM - 24 && cabe < Math.min(resto.length, 4)) { nova(); cabe = Math.floor((y - MARGEM - 24 - 30) / 14); }
              var parte = resto.splice(0, cabe), hh = 18 + parte.length * 14 + 12;
              pg.drawRectangle({ x: MARGEM, y: y - hh, width: UTIL, height: hh, color: cor(ehSol ? VERDE_S : eu ? ROSA_S : SF2), borderColor: cor(LN), borderWidth: 0.6 });
              var nome = (eu ? quem + ' (você)' : quem) + (iniciou ? ' (continuação)' : '');
              txt(nome, MARGEM + 12, y - 15, FB, 10, ehSol ? VERDE : eu ? ROSA : NAVY);
              var wx = MARGEM + 12 + FB.widthOfTextAtSize(limpo(nome, FB), 10) + 8;
              if (tag && !iniciou) { txt(tag, wx, y - 15, FB, 8, TX3); wx += FB.widthOfTextAtSize(limpo(tag, FB), 8) + 8; }
              if (quando) txt(quando, MARGEM + UTIL - 12 - F1.widthOfTextAtSize(quando, 8.5), y - 15, F1, 8.5, TX3);
              var yy = y - 32;
              parte.forEach(function (l) { txt(l, MARGEM + 12, yy, F1, 10.5, NAVY); yy -= 14; });
              y -= hh + 8; iniciou = true;
            }
          });

          // ---- anexos ----
          var lista = anexos || [];
          espaco(40);
          y -= 6; txt('ANEXOS (' + lista.length + ')', MARGEM, y - 10, FB, 9.5, TX2); y -= 22;
          if (!lista.length) { txt('Nenhum anexo neste chamado.', MARGEM, y - 10, F1, 10, TX3); y -= 18; }
          lista.forEach(function (a, ix) {
            var nome = a.original_filename || a.filename || ('Anexo ' + (ix + 1));
            espaco(30);
            txt((ix + 1) + '. ' + quebrar(nome, FB, 10, UTIL - 20)[0], MARGEM, y - 10, FB, 10, NAVY);
            txt([tamanho(a.size_bytes), a.uploaded_by_name, dataHora(a.created_at)].filter(Boolean).join(' · '), MARGEM + 14, y - 23, F1, 8.5, TX3);
            y -= 32;
          });
          var cadeia = Promise.resolve();
          return cadeia.then(function () {
            // rodapé em todas as páginas da conversa (as copiadas de anexos ficam como estão)
            var agora = dataHora(new Date().toISOString()), n = doc.getPageCount();
            doc.getPages().forEach(function (p, i) {
              var s = limpo('Chamado ' + (t.protocol || '') + ' · página ' + (i + 1) + ' de ' + n + ' · gerado pelo App Freedom em ' + agora, F1);
              p.drawText(s, { x: MARGEM, y: 22, size: 7.5, font: F1, color: cor(TX3) });
            });
            doc.setTitle('Chamado ' + (t.protocol || '') + ' · ' + (t.title || ''));
            doc.setAuthor('App Freedom'); doc.setCreator('App Freedom');
            return doc.saveAsBase64();
          });
        });
      });
    });
  };
})();
