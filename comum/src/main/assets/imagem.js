/* ============================================================
   Freedom · "Gerar imagem" dos painéis (PNG para mandar no WhatsApp)
   Cada painel define Base.paraImagem() devolvendo uma descrição:
     { titulo, sub, blocos: [ {tipo:'card', blocos:[...]}, {tipo:'secao', t, d}, ... ] }
   Tipos de bloco: hero, tiles, secao, ranking, tipos, dist, nota, card.
   O logo vai embutido (logo-dados.js) para o canvas poder ser exportado.
   ============================================================ */
(function () {
  var W = 540, ESC = 2, M = 20, PAD = 16;
  var C = { bg: '#0b0d12', sf: '#12151d', sf2: '#171b25', ln: '#232a3a', ln2: '#2c3447', tx: '#f3f5f9', tx2: '#a3abbd', tx3: '#6b7489',
            rosa: '#e84b8a', azul: '#4f7cff', verde: '#1fbf8f', laranja: '#f0a53a', violeta: '#8b6cf0', vermelho: '#ef4444' };
  var FONTE = 'Roboto, "Segoe UI", system-ui, sans-serif';

  function fonte(ctx, tam, peso) { ctx.font = (peso || 400) + ' ' + tam + 'px ' + FONTE; }
  function cor(c) { return C[c] || c || C.tx; }
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  /** escreve cortando com "…" se não couber */
  function texto(ctx, t, x, y, max, alinhar) {
    t = String(t == null ? '' : t);
    if (max && ctx.measureText(t).width > max) {
      while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
      t += '…';
    }
    ctx.textAlign = alinhar || 'left'; ctx.fillText(t, x, y); ctx.textAlign = 'left';
  }
  /** quebra em linhas; devolve a altura usada */
  function paragrafo(ctx, t, x, y, max, alt) {
    var palavras = String(t || '').split(' '), linha = '', yy = y;
    for (var i = 0; i < palavras.length; i++) {
      var teste = linha ? linha + ' ' + palavras[i] : palavras[i];
      if (ctx.measureText(teste).width > max && linha) { ctx.fillText(linha, x, yy); linha = palavras[i]; yy += alt; }
      else linha = teste;
    }
    if (linha) ctx.fillText(linha, x, yy);
    return yy - y + alt;
  }
  function barra(ctx, x, y, w, h, p, idealP, c) {
    ctx.fillStyle = C.ln2; rr(ctx, x, y, w, h, h / 2); ctx.fill();
    var pw = Math.max(0, Math.min(1, p)) * w;
    if (pw > 0) { ctx.fillStyle = cor(c); rr(ctx, x, y, Math.max(pw, h), h, h / 2); ctx.fill(); }
    if (idealP != null) { ctx.fillStyle = '#e9ecf3'; ctx.fillRect(x + Math.max(0, Math.min(1, idealP)) * w - 1, y - 4, 2, h + 8); }
  }

  // ---- cada bloco desenha a partir de y e devolve o novo y ----
  var B = {
    hero: function (ctx, b, x, y, w) {
      fonte(ctx, 11, 700); ctx.fillStyle = C.tx3; texto(ctx, String(b.rot || '').toUpperCase(), x, y + 12, w);
      y += 22;
      fonte(ctx, 15, 700); ctx.fillStyle = C.rosa; ctx.fillText('R$', x, y + 22);
      var lw = ctx.measureText('R$ ').width;
      fonte(ctx, 34, 800); ctx.fillStyle = C.tx; texto(ctx, F.num(b.valor), x + lw, y + 34, w - lw);
      y += 46;
      if (b.pill) {
        fonte(ctx, 12, 700); var pw = ctx.measureText(b.pill).width + 20;
        ctx.fillStyle = 'rgba(255,255,255,.07)'; rr(ctx, x, y, pw, 24, 12); ctx.fill();
        ctx.fillStyle = C.tx2; ctx.fillText(b.pill, x + 10, y + 16);
        if (b.sub) { fonte(ctx, 12); ctx.fillStyle = C.tx3; texto(ctx, b.sub, x + pw + 10, y + 16, w - pw - 10); }
        y += 34;
      }
      if (b.p != null) {
        barra(ctx, x, y, w, 10, b.p, b.idealP, b.cor || C.azul);
        y += 22;
        fonte(ctx, 11); ctx.fillStyle = C.tx3;
        ctx.fillText('0', x, y + 4);
        if (b.legIdeal) texto(ctx, b.legIdeal, x + w / 2, y + 4, w / 2, 'center');
        if (b.legMeta) texto(ctx, b.legMeta, x + w, y + 4, w / 3, 'right');
        y += 14;
      }
      return y + 4;
    },
    tiles: function (ctx, b, x, y, w) {
      var cols = b.cols || 3, g = 8, tw = (w - g * (cols - 1)) / cols, grande = cols <= 2, th = grande ? 62 : 54;
      for (var i = 0; i < b.itens.length; i++) {
        var it = b.itens[i], cx = x + (i % cols) * (tw + g), cy = y + Math.floor(i / cols) * (th + g);
        ctx.fillStyle = C.sf2; rr(ctx, cx, cy, tw, th, 12); ctx.fill();
        ctx.strokeStyle = C.ln; ctx.lineWidth = 1; ctx.stroke();
        fonte(ctx, 11); ctx.fillStyle = C.tx3; texto(ctx, it.r, cx + 11, cy + 20, tw - 22);
        fonte(ctx, grande ? 19 : 16, 800); ctx.fillStyle = it.c ? cor(it.c) : C.tx; texto(ctx, it.v, cx + 11, cy + (grande ? 47 : 42), tw - 22);
      }
      return y + Math.ceil(b.itens.length / cols) * (th + g) - g + 12;
    },
    secao: function (ctx, b, x, y, w) {
      y += 8;
      fonte(ctx, 12, 700); ctx.fillStyle = C.tx2; texto(ctx, String(b.t || '').toUpperCase(), x, y + 12, w * 0.7);
      if (b.d) { fonte(ctx, 12); ctx.fillStyle = C.tx3; texto(ctx, b.d, x + w, y + 12, w * 0.3, 'right'); }
      return y + 24;
    },
    ranking: function (ctx, b, x, y, w) {
      for (var i = 0; i < b.itens.length; i++) {
        var it = b.itens[i], h = it.sub ? 64 : 50;
        ctx.fillStyle = C.sf; rr(ctx, x, y, w, h, 12); ctx.fill(); ctx.strokeStyle = C.ln; ctx.lineWidth = 1; ctx.stroke();
        var ix = x + 12, iw = w - 24;
        fonte(ctx, 12, 700); ctx.fillStyle = C.tx3; var rk = (it.rank || i + 1) + 'º'; ctx.fillText(rk, ix, y + 20);
        var rkw = ctx.measureText('00º ').width;
        fonte(ctx, 13, 700); var vw = ctx.measureText(it.valor).width;
        fonte(ctx, 11); var pw = it.pct ? ctx.measureText(it.pct).width + 8 : 0;
        fonte(ctx, 13, 500); ctx.fillStyle = C.tx; texto(ctx, it.nome, ix + rkw, y + 20, iw - rkw - vw - pw - 10);
        fonte(ctx, 13, 700); ctx.fillStyle = C.tx; texto(ctx, it.valor, ix + iw - pw, y + 20, 0, 'right');
        if (pw) { fonte(ctx, 11); ctx.fillStyle = C.tx3; texto(ctx, it.pct, ix + iw, y + 20, 0, 'right'); }
        barra(ctx, ix, y + 30, iw, 6, it.p || 0, it.idealP, it.cor || C.azul);
        if (it.sub) { fonte(ctx, 11); ctx.fillStyle = C.tx3; texto(ctx, it.sub, ix, y + 54, iw); }
        y += h + 6;
      }
      if (b.mais) { fonte(ctx, 12); ctx.fillStyle = C.tx3; texto(ctx, b.mais, x + w / 2, y + 12, w, 'center'); y += 20; }
      return y + 4;
    },
    tipos: function (ctx, b, x, y, w) {
      for (var i = 0; i < b.itens.length; i++) {
        var it = b.itens[i], h = 50;
        ctx.fillStyle = C.sf; rr(ctx, x, y, w, h, 12); ctx.fill(); ctx.strokeStyle = C.ln; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = it.cor || C.tx3; rr(ctx, x + 12, y + 15, 6, 20, 3); ctx.fill();
        fonte(ctx, 14, 700); var vw = ctx.measureText(it.valor).width;
        ctx.fillStyle = C.tx; texto(ctx, it.valor, x + w - 12, y + 22, 0, 'right');
        fonte(ctx, 14, 600); texto(ctx, it.nome, x + 28, y + 22, w - 60 - vw);
        fonte(ctx, 11.5); ctx.fillStyle = C.tx3; texto(ctx, it.sub || '', x + 28, y + 39, w - 120);
        if (it.pct) texto(ctx, it.pct, x + w - 12, y + 39, 0, 'right');
        y += h + 6;
      }
      return y + 4;
    },
    dist: function (ctx, b, x, y, w) {
      var tot = 0; b.partes.forEach(function (p) { tot += p.frac; });
      var cx = x;
      ctx.save(); rr(ctx, x, y, w, 10, 5); ctx.clip();
      b.partes.forEach(function (p) { var pw = tot ? p.frac / tot * w : 0; ctx.fillStyle = p.cor; ctx.fillRect(cx, y, pw + 0.5, 10); cx += pw; });
      ctx.restore();
      return y + 22;
    },
    nota: function (ctx, b, x, y, w) {
      fonte(ctx, 11.5); ctx.fillStyle = C.tx3; return y + paragrafo(ctx, b.t, x, y + 12, w, 16) + 4;
    },
    linha: function (ctx, b, x, y, w) {   // rótulo à esquerda, valor grande à direita
      fonte(ctx, 12); ctx.fillStyle = C.tx3; texto(ctx, b.r, x, y + 18, w * 0.55);
      fonte(ctx, 18, 800); ctx.fillStyle = b.c ? cor(b.c) : C.tx; texto(ctx, b.v, x + w, y + 20, w * 0.45, 'right');
      return y + 32;
    },
    grafico: function (ctx, b, x, y, w) {   // vendido acumulado × ideal, com a venda de cada dia em barras
      var dd = b.dados || [], n = dd.length; if (n < 2) return y;
      fonte(ctx, 11, 700); ctx.fillStyle = C.tx2; texto(ctx, String(b.titulo || 'Evolução').toUpperCase(), x, y + 12, w * 0.6);
      var u = -1; dd.forEach(function (d, k) { if (d.a != null) u = k; });
      var ult = u >= 0 ? dd[u] : null, dif = ult ? F.n(ult.a) - F.n(ult.i) : 0, corR = ult && dif >= 0 ? C.azul : C.rosa;
      if (ult) { fonte(ctx, 11.5, 700); ctx.fillStyle = dif >= 0 ? C.verde : C.laranja;
        texto(ctx, (dif >= 0 ? F.brlK(dif) + ' acima do ideal' : F.brlK(-dif) + ' abaixo do ideal'), x + w, y + 12, w * 0.45, 'right'); }
      y += 22;
      var H = 150, T = 12, Bm = 18, meta = F.n(b.meta), maxY = meta, maxV = 0;
      dd.forEach(function (d) { maxY = Math.max(maxY, F.n(d.a), F.n(d.i)); maxV = Math.max(maxV, F.n(d.v)); });
      maxY = maxY * 1.06 || 1;
      var pw = w / n;
      function X(k) { return x + pw * (k + 0.5); }
      function Y(v) { return y + T + (H - T - Bm) * (1 - v / maxY); }
      var base = y + H - Bm;
      ctx.fillStyle = C.ln2; ctx.fillRect(x, base, w, 1);
      if (maxV > 0) { ctx.fillStyle = 'rgba(79,124,255,.30)';
        dd.forEach(function (d, k) { var bh = (H - T - Bm) * 0.32 * F.n(d.v) / maxV; if (bh > 0) { rr(ctx, X(k) - pw * 0.32, base - bh, pw * 0.64, bh, 1.5); ctx.fill(); } }); }
      if (meta > 0) { ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = C.verde; ctx.globalAlpha = .8; ctx.beginPath(); ctx.moveTo(x, Y(meta)); ctx.lineTo(x + w, Y(meta)); ctx.stroke(); ctx.restore();
        fonte(ctx, 10); ctx.fillStyle = C.verde; texto(ctx, 'meta ' + F.brlK(meta), x + w, Y(meta) - 4, w / 2, 'right'); }
      ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = C.tx2; ctx.globalAlpha = .75; ctx.lineWidth = 1.4; ctx.beginPath();
      dd.forEach(function (d, k) { if (k) ctx.lineTo(X(k), Y(F.n(d.i))); else ctx.moveTo(X(k), Y(F.n(d.i))); }); ctx.stroke(); ctx.restore();
      if (u >= 0) {
        var g = ctx.createLinearGradient(0, y + T, 0, base); g.addColorStop(0, corR === C.azul ? 'rgba(79,124,255,.30)' : 'rgba(232,75,138,.30)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath(); ctx.moveTo(X(0), base);
        for (var k = 0; k <= u; k++) ctx.lineTo(X(k), Y(F.n(dd[k].a)));
        ctx.lineTo(X(u), base); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
        ctx.beginPath(); for (k = 0; k <= u; k++) { if (k) ctx.lineTo(X(k), Y(F.n(dd[k].a))); else ctx.moveTo(X(k), Y(F.n(dd[k].a))); }
        ctx.strokeStyle = corR; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
        ctx.beginPath(); ctx.arc(X(u), Y(F.n(ult.a)), 3.8, 0, Math.PI * 2); ctx.fillStyle = corR; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = C.sf; ctx.stroke();
        fonte(ctx, 11, 700); ctx.fillStyle = C.tx; texto(ctx, F.brlK(ult.a), Math.min(X(u) + 6, x + w - 60), Y(F.n(ult.a)) - 8, 80);
      }
      function dm(t) { return String(t).slice(8, 10) + '/' + String(t).slice(5, 7); }
      fonte(ctx, 10); ctx.fillStyle = C.tx3;
      texto(ctx, dm(dd[0].d), x, y + H - 3, 60); texto(ctx, dm(dd[Math.floor((n - 1) / 2)].d), X(Math.floor((n - 1) / 2)), y + H - 3, 60, 'center'); texto(ctx, dm(dd[n - 1].d), x + w, y + H - 3, 60, 'right');
      y += H + 8;
      // legenda
      fonte(ctx, 11); var lx = x;
      [[corR, 'Vendido (acumulado)'], [C.tx2, 'Ideal'], ['rgba(79,124,255,.55)', 'Venda do dia']].forEach(function (l, i) {
        if (i === 2 && !maxV) return;
        ctx.fillStyle = l[0]; rr(ctx, lx, y + 4, 14, 3, 1.5); ctx.fill(); ctx.fillStyle = C.tx3; ctx.fillText(l[1], lx + 19, y + 9); lx += 19 + ctx.measureText(l[1]).width + 16;
      });
      return y + 20;
    },
    card: function (ctx, b, x, y, w) {
      var y0 = y, yy = y + PAD;
      b.blocos.forEach(function (k) { yy = desenhar(ctx, k, x + PAD, yy, w - PAD * 2); });
      yy += PAD - 8;
      ctx.save(); ctx.globalCompositeOperation = 'destination-over';
      ctx.strokeStyle = C.ln; ctx.lineWidth = 1; rr(ctx, x + .5, y0 + .5, w - 1, yy - y0 - 1, 16); ctx.stroke();
      ctx.fillStyle = b.cor || C.sf; rr(ctx, x, y0, w, yy - y0, 16); ctx.fill();
      ctx.restore();
      return yy + 12;
    }
  };
  function desenhar(ctx, b, x, y, w) { return (B[b.tipo] || function () { return y; })(ctx, b, x, y, w); }

  function dois(n) { return ('0' + n).slice(-2); }
  function agora() { var d = new Date(); return dois(d.getDate()) + '/' + dois(d.getMonth() + 1) + '/' + d.getFullYear() + ' às ' + dois(d.getHours()) + ':' + dois(d.getMinutes()); }

  /** Desenha a descrição e chama pronto(dataUrl) */
  F.desenharImagem = function (spec, pronto) {
    var logo = new Image();
    var fazer = function () {
      var tela = document.createElement('canvas');
      tela.width = W * ESC; tela.height = 4600 * ESC;
      var ctx = tela.getContext('2d');
      ctx.scale(ESC, ESC); ctx.textBaseline = 'alphabetic';
      var y = M;
      // cabeçalho: logo + título + quem/quando
      var lw = 0;
      if (logo.width) { var lh = 36; lw = Math.min(110, logo.width / logo.height * lh); ctx.drawImage(logo, M, y + 2, lw, lw / (logo.width / logo.height)); }
      var tx = M + (lw ? lw + 14 : 0);
      fonte(ctx, 21, 800); ctx.fillStyle = C.tx; texto(ctx, spec.titulo || 'Painel', tx, y + 18, W - tx - M);
      fonte(ctx, 12.5); ctx.fillStyle = C.tx2; texto(ctx, spec.sub || '', tx, y + 37, W - tx - M);
      y += 52;
      fonte(ctx, 11.5); ctx.fillStyle = C.tx3; texto(ctx, spec.quando || ('Gerado em ' + agora()), M, y + 12, W - M * 2);
      y += 24;
      (spec.blocos || []).forEach(function (b) { y = desenhar(ctx, b, M, y, W - M * 2); });
      // rodapé
      ctx.fillStyle = C.ln; ctx.fillRect(M, y + 2, W - M * 2, 1);
      fonte(ctx, 11); ctx.fillStyle = C.tx3;
      texto(ctx, 'App Freedom · relatorios.cbfreedom.com.br', M, y + 22, W - M * 2 - 200);
      texto(ctx, 'Gerado em ' + agora(), W - M, y + 22, 200, 'right');
      y += 34;
      // fundo por baixo de tudo e recorte na altura usada
      ctx.save(); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, y); ctx.restore();
      var fim = document.createElement('canvas');
      fim.width = W * ESC; fim.height = Math.ceil(y * ESC);
      fim.getContext('2d').drawImage(tela, 0, 0);
      var url = null;
      try { url = fim.toDataURL('image/png'); } catch (e) { url = null; }
      pronto(url);
    };
    logo.onload = fazer; logo.onerror = fazer;
    logo.src = F.LOGO || 'logo.png';
  };

  // ---- tela de prévia com os botões ----
  var ultimaUrl = null, ultimoNome = '';
  function plataforma() { try { return App.plataforma ? App.plataforma() : 'android'; } catch (e) { return 'android'; } }
  function nomeArquivo(base) {
    var d = new Date();
    return (base || 'Painel').replace(/[^\wÀ-ú-]+/g, '-') + '_' + d.getFullYear() + dois(d.getMonth() + 1) + dois(d.getDate()) + '_' + dois(d.getHours()) + dois(d.getMinutes()) + '.png';
  }
  function base64(url) { return url.substring(url.indexOf(',') + 1); }

  F.gerarImagem = function (pronta) {
    var spec = pronta && pronta.blocos ? pronta : null;
    if (!spec) try { spec = Base.paraImagem && Base.paraImagem(); } catch (e) { spec = null; }
    if (!spec) { F.toast('Espere os números carregarem para gerar a imagem'); return; }
    var m = document.getElementById('modalImg');
    if (!m) {
      var win = ['windows', 'mac'].indexOf(plataforma()) >= 0;   // computador: copiar e colar (Ctrl+V / ⌘V)
      document.body.insertAdjacentHTML('beforeend',
        '<div class="fundo-modal" id="modalImg"><div class="modal img"><h3>Imagem do painel</h3><p id="imgInfo">Gerando…</p>' +
        '<div class="previa" id="imgPrev"></div>' +
        (win ? '<button class="b1" id="imgCompart">' + F.ic('copiar') + ' Copiar imagem</button>'
             : '<button class="b1" id="imgCompart">' + F.ic('compartilhar') + ' Compartilhar (WhatsApp…)</button>') +
        '<button class="b2" id="imgSalvar">' + F.ic('baixar') + (win ? ' Salvar em Imagens' : ' Salvar na galeria') + '</button>' +
        '<button class="b3" id="imgFechar">Fechar</button></div></div>');
      m = document.getElementById('modalImg');
      m.onclick = function (ev) { if (ev.target.id === 'modalImg') m.classList.remove('on'); };
      document.getElementById('imgFechar').onclick = function () { m.classList.remove('on'); };
      document.getElementById('imgCompart').onclick = function () {
        if (!ultimaUrl) return;
        try { if (win) App.copiarImagem(base64(ultimaUrl)); else App.compartilharImagem(base64(ultimaUrl), ultimoNome); }
        catch (e) { F.toast('Não consegui: ' + e.message); }
      };
      document.getElementById('imgSalvar').onclick = function () {
        if (!ultimaUrl) return;
        try { App.salvarImagem(base64(ultimaUrl), ultimoNome); } catch (e) { F.toast('Não consegui salvar: ' + e.message); }
      };
    }
    ultimaUrl = null; ultimoNome = nomeArquivo(spec.arquivo || spec.titulo);
    document.getElementById('imgPrev').innerHTML = '<div class="carregando"><i></i>Gerando a imagem…</div>';
    document.getElementById('imgInfo').textContent = 'Gerando…';
    m.classList.add('on');
    setTimeout(function () {
      F.desenharImagem(spec, function (url) {
        if (!url) { document.getElementById('imgPrev').innerHTML = ''; document.getElementById('imgInfo').textContent = 'Não consegui gerar a imagem.'; return; }
        ultimaUrl = url;
        document.getElementById('imgPrev').innerHTML = '<img src="' + url + '" alt="Prévia da imagem">';
        document.getElementById('imgInfo').textContent = ultimoNome;
      });
    }, 30);
  };
})();
