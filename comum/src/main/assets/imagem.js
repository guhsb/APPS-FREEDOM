/* ============================================================
   Freedom · "Gerar imagem" dos painéis (PNG para mandar no WhatsApp)
   Cada painel define Base.paraImagem() devolvendo uma descrição:
     { titulo, sub, blocos: [ {tipo:'card', blocos:[...]}, {tipo:'secao', t, d}, ... ] }
   Tipos de bloco: hero, tiles, secao, ranking, tipos, dist, nota, card.
   O logo vai embutido (logo-dados.js) para o canvas poder ser exportado.
   ============================================================ */
(function () {
  var W = 540, ESC = 2, M = 20, PAD = 16;
  // a imagem segue o tema do app (claro = cores do site)
  var ESCURO = { bg: '#0b0d12', sf: '#12151d', sf2: '#171b25', ln: '#232a3a', ln2: '#2c3447', tx: '#f3f5f9', tx2: '#a3abbd', tx3: '#6b7489',
            rosa: '#e84b8a', azul: '#4f7cff', verde: '#1fbf8f', laranja: '#f0a53a', violeta: '#8b6cf0', vermelho: '#ef4444',
            marca: '#e9ecf3', pill: 'rgba(255,255,255,.07)' };
  var CLARO = { bg: '#eef2f7', sf: '#ffffff', sf2: '#f6f8fc', ln: '#e1e7ef', ln2: '#e3e8f1', tx: '#0f1b3d', tx2: '#4b5875', tx3: '#7b879e',
            rosa: '#e0457f', azul: '#3b5bfd', verde: '#0e9f6e', laranja: '#d97706', violeta: '#6d4fe0', vermelho: '#dc2626',
            marca: '#0f1b3d', pill: '#e8edf5' };
  var C = ESCURO;
  // cores fixas que os painéis mandam (as do tema escuro) -> a mesma cor no tema claro
  var EQUIV = { '#4f7cff': 'azul', '#e84b8a': 'rosa', '#1fbf8f': 'verde', '#f0a53a': 'laranja', '#8b6cf0': 'violeta', '#ef4444': 'vermelho', '#3a4154': 'ln2', '#8b93a7': 'tx3' };
  var FONTE = 'Roboto, "Segoe UI", system-ui, sans-serif';

  function fonte(ctx, tam, peso) { ctx.font = (peso || 400) + ' ' + tam + 'px ' + FONTE; }
  function cor(c) { if (C === CLARO && c && EQUIV[String(c).toLowerCase()]) return C[EQUIV[String(c).toLowerCase()]]; return C[c] || c || C.tx; }
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
  /** Quebra o texto em linhas que cabem em "max" (respeita \n e corta palavra comprida). */
  function quebrar(ctx, t, max) {
    var out = [];
    String(t == null ? '' : t).split('\n').forEach(function (par) {
      var linha = '';
      par.split(' ').forEach(function (p) {
        while (ctx.measureText(p).width > max && p.length > 1) {   // palavra maior que a coluna
          var k = p.length; while (k > 1 && ctx.measureText(p.slice(0, k)).width > max) k--;
          if (linha) { out.push(linha); linha = ''; } out.push(p.slice(0, k)); p = p.slice(k);
        }
        var teste = linha ? linha + ' ' + p : p;
        if (ctx.measureText(teste).width > max && linha) { out.push(linha); linha = p; } else linha = teste;
      });
      out.push(linha);
    });
    return out;
  }
  var TAM_PARTE = 10.5;
  function fontePar(ctx, p) { fonte(ctx, p[1] === 'azul' ? TAM_PARTE : TAM_PARTE - 0.5, p[1] === 'azul' ? 700 : 600); }
  /** Texto colorido (partes) em linhas que cabem em "max"; a quebra acontece num intervalo (café/almoço vai para a linha de baixo). */
  function linhasPartes(ctx, partes, max) {
    var out = [], cur = [], w = 0;
    partes.forEach(function (p) {
      fontePar(ctx, p); var pw = ctx.measureText(p[0]).width;
      if (cur.length && w + pw > max && p[1] === 'azul' && cur.length > 1) {
        // leva o nome do intervalo junto para a próxima linha
        var sep = cur[cur.length - 1][1] !== 'azul' ? cur.pop() : null; out.push({ partes: cur }); cur = sep ? [[sep[0].replace(/^\s+/, ''), sep[1]]] : []; w = 0;
        cur.forEach(function (q) { fontePar(ctx, q); w += ctx.measureText(q[0]).width; });
      }
      cur.push(p); fontePar(ctx, p); w += ctx.measureText(p[0]).width;
    });
    if (cur.length) out.push({ partes: cur });
    return out;
  }
  function barra(ctx, x, y, w, h, p, idealP, c) {
    ctx.fillStyle = C.ln2; rr(ctx, x, y, w, h, h / 2); ctx.fill();
    var pw = Math.max(0, Math.min(1, p)) * w;
    if (pw > 0) { ctx.fillStyle = cor(c); rr(ctx, x, y, Math.max(pw, h), h, h / 2); ctx.fill(); }
    if (idealP != null) { ctx.fillStyle = C.marca; ctx.fillRect(x + Math.max(0, Math.min(1, idealP)) * w - 1, y - 4, 2, h + 8); }
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
        ctx.fillStyle = C.pill; rr(ctx, x, y, pw, 24, 12); ctx.fill();
        ctx.fillStyle = C.tx2; ctx.fillText(b.pill, x + 10, y + 16);
        if (b.sub) { fonte(ctx, 12); ctx.fillStyle = C.tx3; texto(ctx, b.sub, x + pw + 10, y + 16, w - pw - 10); }
        y += 34;
      }
      if (b.p != null) {
        barra(ctx, x, y, w, 10, b.p, b.idealP, b.cor || C.azul);
        y += 22;
        fonte(ctx, 11); ctx.fillStyle = C.tx3;
        texto(ctx, b.legEsq || '0', x, y + 4, w / 3);
        if (b.legIdeal) texto(ctx, b.legIdeal, x + w / 2, y + 4, w / 2, 'center');
        if (b.legMeta) { if (/^Falta/.test(b.legMeta)) ctx.fillStyle = C.laranja; else if (b.legEsq) ctx.fillStyle = C.verde; texto(ctx, b.legMeta, x + w, y + 4, w / 3, 'right'); }
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
        ctx.fillStyle = it.cor ? cor(it.cor) : C.tx3; rr(ctx, x + 12, y + 15, 6, 20, 3); ctx.fill();
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
      b.partes.forEach(function (p) { var pw = tot ? p.frac / tot * w : 0; ctx.fillStyle = cor(p.cor); ctx.fillRect(cx, y, pw + 0.5, 10); cx += pw; });
      ctx.restore();
      return y + 22;
    },
    nota: function (ctx, b, x, y, w) {
      fonte(ctx, 11.5); ctx.fillStyle = C.tx3; return y + paragrafo(ctx, b.t, x, y + 12, w, 16) + 4;
    },
    linha: function (ctx, b, x, y, w) {   // rótulo à esquerda, valor grande à direita
      fonte(ctx, 12); ctx.fillStyle = C.tx3; texto(ctx, b.r, x, y + 18, b.extra ? w * 0.36 : w * 0.55);
      if (b.extra) {   // valor + variação na mesma linha, na mesma cor ("R$ 955.796,25  ▲ 5,2%"), diminuindo junto se não couber
        var tam = 18, maxW = w * 0.62, ext;
        for (; tam > 12; tam -= 0.5) {
          fonte(ctx, tam, 800); var wv = ctx.measureText(b.v).width;
          fonte(ctx, tam * 0.72, 700); ext = ctx.measureText(b.extra).width;
          if (wv + 8 + ext <= maxW) break;
        }
        ctx.fillStyle = b.c ? cor(b.c) : C.tx;
        fonte(ctx, tam * 0.72, 700); ctx.textAlign = 'right'; ctx.fillText(b.extra, x + w, y + 20);
        fonte(ctx, tam, 800); ctx.fillText(b.v, x + w - ext - 8, y + 20); ctx.textAlign = 'left';
        return y + 32;
      }
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
    /** Tabela: { titulo, cols: [[rótulo, 'l'|'r', fração da largura]], linhas: [[...]], vazio } */
    tabela: function (ctx, b, x, y, w) {
      var y0 = y, ix = x + 12, iw = w - 24, cols = b.cols, lin = b.linhas || [], LIM = b.lim || 80, extra = Math.max(0, lin.length - LIM);
      lin = lin.slice(0, LIM);
      var xs = [], acc = 0; cols.forEach(function (c) { xs.push(ix + acc * iw); acc += c[2]; });
      var yy = y + 14;
      if (b.titulo) { fonte(ctx, 13.5, 800); ctx.fillStyle = b.cor ? cor(b.cor) : C.tx; texto(ctx, b.titulo, ix, yy + 12, iw * 0.7);
        if (b.d) { fonte(ctx, 11.5); ctx.fillStyle = C.tx3; texto(ctx, b.d, ix + iw, yy + 12, iw * 0.3, 'right'); } yy += 24; }
      fonte(ctx, 10.5, 700); ctx.fillStyle = C.tx3;
      cols.forEach(function (c, k) { var cw = c[2] * iw; if (c[1] === 'r') texto(ctx, c[0].toUpperCase(), xs[k] + cw, yy + 10, cw - 4, 'right'); else texto(ctx, c[0].toUpperCase(), xs[k], yy + 10, cw - 6); });
      yy += 16; ctx.fillStyle = C.ln; ctx.fillRect(ix, yy, iw, 1); yy += 2;
      if (!lin.length) { fonte(ctx, 12); ctx.fillStyle = C.tx3; texto(ctx, b.vazio || '—', ix, yy + 18, iw); yy += 26; }
      lin.forEach(function (l, i) {
        fonte(ctx, 12, 400);
        cols.forEach(function (c, k) { var cw = c[2] * iw, v = l[k] == null ? '—' : String(l[k]);
          ctx.fillStyle = k === 0 ? C.tx : (c[1] === 'r' ? C.tx : C.tx2); if (k === 0 || c[3]) fonte(ctx, 12, k === 0 ? 600 : 700); else fonte(ctx, 12, 400);
          if (c[1] === 'r') texto(ctx, v, xs[k] + cw, yy + 17, cw - 6, 'right'); else texto(ctx, v, xs[k], yy + 17, cw - 8); });
        if (l.sub) { fonte(ctx, 11.5, 400); ctx.fillStyle = C.tx2; texto(ctx, l.sub, ix, yy + 34, iw); }
        yy += l.sub ? 42 : 25;
        if (i < lin.length - 1) { ctx.fillStyle = C.ln; ctx.fillRect(ix, yy - 1, iw, 1); }
      });
      if (extra) { fonte(ctx, 11.5); ctx.fillStyle = C.tx3; texto(ctx, '+ ' + extra + ' itens (veja no app)', ix, yy + 14, iw); yy += 22; }
      yy += 8;
      ctx.save(); ctx.globalCompositeOperation = 'destination-over';
      ctx.strokeStyle = C.ln; ctx.lineWidth = 1; rr(ctx, x + .5, y0 + .5, w - 1, yy - y0 - 1, 16); ctx.stroke();
      ctx.fillStyle = C.sf; rr(ctx, x, y0, w, yy - y0, 16); ctx.fill(); ctx.restore();
      return yy + 12;
    },
    colunas: function (ctx, b, x, y, w) {   // barras por dia (a destacada em rosa) + linha da média
      var dd = b.dados || [], n = dd.length; if (!n) return y;
      fonte(ctx, 11, 700); ctx.fillStyle = C.tx2; texto(ctx, String(b.titulo || '').toUpperCase(), x, y + 12, w * 0.6);
      if (b.d) { fonte(ctx, 11); ctx.fillStyle = C.tx3; texto(ctx, b.d, x + w, y + 12, w * 0.4, 'right'); }
      var top = y + 26, H = 110, base = top + H, mx = 1;
      dd.forEach(function (k) { mx = Math.max(mx, F.n(k.v)); }); if (b.media) mx = Math.max(mx, F.n(b.media)); mx *= 1.12;
      var bw = w / n;
      dd.forEach(function (k, i) {
        var hh = F.n(k.v) / mx * H, bx = x + i * bw + Math.min(2, bw * 0.15);
        ctx.fillStyle = k.on ? C.rosa : C.azul; rr(ctx, bx, base - Math.max(2, hh), Math.max(2, bw - Math.min(4, bw * 0.3)), Math.max(2, hh), 3); ctx.fill();
        if (k.r) { fonte(ctx, 9.5); ctx.fillStyle = C.tx3; texto(ctx, k.r, x + i * bw + bw / 2, base + 14, 0, 'center'); }
      });
      if (b.media) { var ym = base - F.n(b.media) / mx * H; ctx.strokeStyle = C.tx2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, ym); ctx.lineTo(x + w, ym); ctx.stroke(); ctx.setLineDash([]);
        if (b.txtMedia) { fonte(ctx, 10); ctx.fillStyle = C.tx2; texto(ctx, b.txtMedia, x + w, ym - 4, w * 0.5, 'right'); } }
      return base + 26;
    },
    // tabela estilo planilha (Excel): cabeçalho escuro, faixas de seção, grade, texto que quebra linha
    planilha: function (ctx, b, x, y, w) {
      var cols = b.cols, xs = [], acc = 0, PADX = 6, LH = 15, y0 = y, hh = 28, SH = 26;
      cols.forEach(function (c) { xs.push(x + acc * w); acc += c[1]; });
      var cw = function (k) { return cols[k][1] * w; }, fc = function (k) { fonte(ctx, cols[k][2] === 'c' ? 11 : 11.5, k === 0 ? 700 : (cols[k][2] === 'c' ? 600 : 400)); };
      // 1º mede (para arredondar os cantos certinho), depois desenha
      var rs = (b.linhas || []).map(function (r) {
        if (r.sec) return { r: r, h: SH };
        var ls = r.c.map(function (v, k) { if (v && v.partes) return linhasPartes(ctx, v.partes, cw(k) - PADX * 2); fc(k); return quebrar(ctx, v == null || v === '' ? '—' : v, cw(k) - PADX * 2); });
        return { r: r, ls: ls, h: Math.max.apply(null, ls.map(function (l) { return l.length; })) * LH + 12 };
      });
      var H = hh + rs.reduce(function (a, z) { return a + z.h; }, 0);
      ctx.save(); rr(ctx, x, y, w, H, 10); ctx.clip();
      ctx.fillStyle = C === CLARO ? '#0f1b3d' : '#2a3350'; ctx.fillRect(x, y, w, hh);
      fonte(ctx, 10.5, 800); ctx.fillStyle = '#ffffff';
      cols.forEach(function (c, k) { texto(ctx, c[0].toUpperCase(), c[2] === 'c' ? xs[k] + cw(k) / 2 : xs[k] + PADX + 2, y + 18, cw(k) - PADX * 2, c[2] === 'c' ? 'center' : 'left'); });
      y += hh;
      var par = 0;
      rs.forEach(function (z) {
        var r = z.r, h = z.h;
        if (r.sec) {
          ctx.fillStyle = C === CLARO ? '#fde8f0' : 'rgba(232,75,138,.18)'; ctx.fillRect(x, y, w, h);
          ctx.fillStyle = C.rosa; ctx.fillRect(x, y, 4, h);
          fonte(ctx, 12, 800); ctx.fillStyle = C.tx; texto(ctx, r.sec, x + PADX + 6, y + 17, w * 0.62);
          if (r.d) { fonte(ctx, 11); ctx.fillStyle = C.tx2; texto(ctx, r.d, x + w - PADX - 4, y + 17, w * 0.36, 'right'); }
          y += h; ctx.fillStyle = C.ln; ctx.fillRect(x, y - 1, w, 1); par = 0; return;
        }
        ctx.fillStyle = par++ % 2 ? C.sf2 : C.sf; ctx.fillRect(x, y, w, h);
        var nl = (h - 12) / LH;
        z.ls.forEach(function (l, k) {
          fc(k); ctx.fillStyle = k === 0 ? C.tx : (cols[k][3] ? cor(cols[k][3]) : C.tx2);
          var top = y + 6 + (nl - l.length) * LH / 2;
          l.forEach(function (t, i) {
            if (t && t.partes) {   // texto colorido numa linha só: diminui a letra até caber
              var larg = t.partes.reduce(function (a, p) { fontePar(ctx, p); return a + ctx.measureText(p[0]).width; }, 0);
              var px = cols[k][2] === 'c' ? xs[k] + (cw(k) - larg) / 2 : xs[k] + PADX + 2;
              t.partes.forEach(function (p) { fontePar(ctx, p); ctx.fillStyle = cor(p[1]); ctx.textAlign = 'left'; ctx.fillText(p[0], px, top + 11 + i * LH); px += ctx.measureText(p[0]).width; });
              return;
            }
            texto(ctx, t, cols[k][2] === 'c' ? xs[k] + cw(k) / 2 : xs[k] + PADX + 2, top + 11 + i * LH, 0, cols[k][2] === 'c' ? 'center' : 'left');
          });
        });
        ctx.fillStyle = C.ln; ctx.fillRect(x, y + h - 1, w, 1);
        for (var k = 1; k < cols.length; k++) ctx.fillRect(xs[k], y, 1, h);
        y += h;
      });
      ctx.restore();
      ctx.strokeStyle = C.ln2; ctx.lineWidth = 1; rr(ctx, x + .5, y0 + .5, w - 1, H - 1, 10); ctx.stroke();
      return y0 + H + 12;
    },
    card: function (ctx, b, x, y, w) {
      var y0 = y, yy = y + PAD;
      b.blocos.forEach(function (k) { yy = desenhar(ctx, k, x + PAD, yy, w - PAD * 2); });
      yy += PAD - 8;
      ctx.save(); ctx.globalCompositeOperation = 'destination-over';
      ctx.strokeStyle = C.ln; ctx.lineWidth = 1; rr(ctx, x + .5, y0 + .5, w - 1, yy - y0 - 1, 16); ctx.stroke();
      ctx.fillStyle = b.cor ? cor(b.cor) : C.sf; rr(ctx, x, y0, w, yy - y0, 16); ctx.fill();
      ctx.restore();
      return yy + 12;
    }
  };
  function desenhar(ctx, b, x, y, w) { return (B[b.tipo] || function () { return y; })(ctx, b, x, y, w); }

  function dois(n) { return ('0' + n).slice(-2); }
  function agora() { var d = new Date(); return dois(d.getDate()) + '/' + dois(d.getMonth() + 1) + '/' + d.getFullYear() + ' às ' + dois(d.getHours()) + ':' + dois(d.getMinutes()); }

  /** Desenha a descrição e chama pronto(dataUrl) */
  var PAGINA = 960;   // toda imagem tem o mesmo tamanho (540 × 960 = 1080 × 1920 px, formato de celular); passou, vai para outra página
  function ctxMedida() { var t0 = document.createElement('canvas'); t0.width = 4; t0.height = 4; var c = t0.getContext('2d'); C = F.tema && F.tema() === 'escuro' ? ESCURO : CLARO; return c; }
  function alturaBloco(ctx, b) { return desenhar(ctx, b, M, 0, W - M * 2); }
  function altLinha(l) { return l && l.sub ? 42 : 25; }
  /** Divide os blocos em páginas do mesmo tamanho. Tabelas são cortadas entre linhas (com o cabeçalho repetido);
      cartões e listas grandes demais também são divididos. */
  function paginar(blocos) {
    var ctx = ctxMedida(), util = PAGINA - (M + 76) - 44, pags = [[]], usado = 0;
    var nova = function () { pags.push([]); usado = 0; };
    var por = function (b, h) { if (usado > 0 && usado + h > util) nova(); pags[pags.length - 1].push(b); usado += h; };
    function bloco(b) {
      if (b.tipo === 'tabela') return tabela(b);
      if (b.tipo === 'planilha') return planilha(b);
      var h = alturaBloco(ctx, b);
      if (h <= util) return por(b, h);
      // grande demais para uma página: divide
      if ((b.tipo === 'tipos' || b.tipo === 'ranking') && b.itens && b.itens.length > 1) {
        var it = b.itens.slice();
        while (it.length) { var n = 1; while (n < it.length && alturaBloco(ctx, Object.assign({}, b, { itens: it.slice(0, n + 1) })) <= util - usado) n++;
          if (usado > 0 && alturaBloco(ctx, Object.assign({}, b, { itens: it.slice(0, 1) })) > util - usado) { nova(); continue; }
          var p = Object.assign({}, b, { itens: it.splice(0, n) }); por(p, alturaBloco(ctx, p)); if (it.length) nova(); }
        return;
      }
      if (b.tipo === 'card' && b.blocos && b.blocos.length > 1) {
        var bs = b.blocos.slice();
        while (bs.length) { var k = 1; while (k < bs.length && alturaBloco(ctx, Object.assign({}, b, { blocos: bs.slice(0, k + 1) })) <= util - usado) k++;
          var c = Object.assign({}, b, { blocos: bs.splice(0, k) }); por(c, alturaBloco(ctx, c)); if (bs.length) nova(); }
        return;
      }
      por(b, h);   // um bloco só, não dá para dividir: vai sozinho na página
    }
    /** Planilha: corta entre linhas; na página seguinte repete o cabeçalho e o nome do setor "(continuação)". */
    function planilha(b) {
      var rows = (b.linhas || []).slice(), sec = null, alt = function (l) { return alturaBloco(ctx, Object.assign({}, b, { linhas: l })); };
      while (rows.length) {
        var pre = sec && !rows[0].sec ? [{ sec: sec.sec + ' (continuação)' }] : [], n = 0;
        while (n < rows.length && alt(pre.concat(rows.slice(0, n + 1))) <= util - usado) n++;
        if (n < 2 && usado > 0 && n < rows.length) { nova(); continue; }
        n = Math.max(1, n);
        var parte = rows.splice(0, n);
        if (parte.length > 1 && rows.length && parte[parte.length - 1].sec) rows.unshift(parte.pop());   // setor não fica sozinho no pé da página
        parte.forEach(function (r) { if (r.sec) sec = r; });
        var bl = Object.assign({}, b, { linhas: pre.concat(parte) });
        pags[pags.length - 1].push(bl); usado += alt(bl.linhas);
        if (rows.length) nova();
      }
    }
    function tabela(b) {
      var lin = (b.linhas || []).slice(0, 1500), primeira = true;
      var vazia = alturaBloco(ctx, Object.assign({}, b, { linhas: [] })), topo = vazia - 26;   // título + cabeçalho + bordas
      if (!lin.length) return por(b, vazia);
      while (lin.length) {
        var livre = util - usado - topo, n = 0, alt = 0;
        while (n < lin.length && alt + altLinha(lin[n]) <= livre) { alt += altLinha(lin[n]); n++; }
        if (n < 3 && usado > 0 && n < lin.length) { nova(); continue; }
        n = Math.max(1, n); alt = 0; for (var i = 0; i < n; i++) alt += altLinha(lin[i]);
        var parte = lin.splice(0, n);
        pags[pags.length - 1].push(Object.assign({}, b, { linhas: parte, lim: parte.length + 1, titulo: primeira ? b.titulo : (b.titulo || '') + ' (continuação)' }));
        usado += topo + alt; primeira = false;
        if (lin.length) nova();
      }
    }
    blocos.forEach(bloco);
    return pags.filter(function (p) { return p.length; });
  }
  /** Gera as páginas (todas do mesmo tamanho): pronto([dataUrl, ...]). */
  F.desenharPaginas = function (spec, pronto) {
    var pags; try { pags = paginar(spec.blocos || []); } catch (e) { pags = [spec.blocos || []]; }
    var urls = [], n = pags.length;
    (function prox(i) {
      if (i >= n) { pronto(urls); return; }
      F.desenharImagem(Object.assign({}, spec, { blocos: pags[i], altura: i < n - 1 ? PAGINA : 0, sub: (spec.sub || '') + (n > 1 ? ' · Página ' + (i + 1) + ' de ' + n : '') }), function (u) { if (u) urls.push(u); prox(i + 1); });
    })(0);
  };
  F.desenharImagem = function (spec, pronto) {
    function medir(ctx) { var y = M + 52 + 24; (spec.blocos || []).forEach(function (b) { y = desenhar(ctx, b, M, y, W - M * 2); }); return y + 34; }
    var logo = new Image();
    var fazer = function () {
      C = F.tema && F.tema() === 'escuro' ? ESCURO : CLARO;
      // 1ª passada num canvas mínimo só para medir a altura; 2ª de verdade
      var altura = 4600;
      try { var t0 = document.createElement('canvas'); t0.width = 4; t0.height = 4; altura = Math.min(14000, medir(t0.getContext('2d')) + 40); } catch (e) { }
      if (spec.altura) altura = Math.max(spec.altura, altura);
      var tela = document.createElement('canvas');
      tela.width = W * ESC; tela.height = altura * ESC;
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
      // rodapé (na página de tamanho fixo, fica sempre no pé)
      if (spec.altura && y < spec.altura - 34) y = spec.altura - 34;
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
  var ultimaUrl = null, ultimasUrls = [], ultimoNome = '';
  function win2() { return ['windows', 'mac'].indexOf(plataforma()) >= 0; }
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
        if (ultimasUrls.length > 1) {   // todas as páginas de uma vez
          var lista = JSON.stringify(ultimasUrls.map(base64));
          try { if (win) App.copiarImagens(lista, ultimoNome); else App.compartilharImagens(lista, ultimoNome); return; }
          catch (e) { F.toast('Esta versão do app manda uma página por vez: use o botão de cada página.'); return; }
        }
        try { if (win) App.copiarImagem(base64(ultimaUrl)); else App.compartilharImagem(base64(ultimaUrl), ultimoNome); }
        catch (e) { F.toast('Não consegui: ' + e.message); }
      };
      document.getElementById('imgSalvar').onclick = function () {
        if (!ultimaUrl) return;
        try {
          if (ultimasUrls.length > 1) ultimasUrls.forEach(function (u, i) { App.salvarImagem(base64(u), ultimoNome.replace(/\.png$/, '_pag' + (i + 1) + '.png')); });
          else App.salvarImagem(base64(ultimaUrl), ultimoNome);
        } catch (e) { F.toast('Não consegui salvar: ' + e.message); }
      };
      document.getElementById('imgPrev').onclick = function (ev) {
        var b = ev.target.closest ? ev.target.closest('[data-pg]') : null; if (!b) return;
        var i = +b.getAttribute('data-pg'), u = ultimasUrls[i]; if (!u) return;
        try { if (win) App.copiarImagem(base64(u)); else App.compartilharImagem(base64(u), ultimoNome.replace(/\.png$/, '_pag' + (i + 1) + '.png')); }
        catch (e) { F.toast('Não consegui: ' + e.message); }
      };
    }
    ultimaUrl = null; ultimasUrls = []; ultimoNome = nomeArquivo(spec.arquivo || spec.titulo);
    document.getElementById('imgPrev').innerHTML = '<div class="carregando"><i></i>Gerando a imagem…</div>';
    document.getElementById('imgInfo').textContent = 'Gerando…';
    m.classList.add('on');
    setTimeout(function () {
      F.desenharPaginas(spec, function (urls) {
        var prev = document.getElementById('imgPrev'), bc = document.getElementById('imgCompart'), bs = document.getElementById('imgSalvar');
        if (!urls.length) { prev.innerHTML = ''; document.getElementById('imgInfo').textContent = 'Não consegui gerar a imagem.'; return; }
        ultimaUrl = urls[0]; ultimasUrls = urls;
        if (urls.length === 1) {
          bc.style.display = ''; bc.lastChild.textContent = win2() ? ' Copiar imagem' : ' Compartilhar (WhatsApp…)';
          bs.lastChild.textContent = win2() ? ' Salvar em Imagens' : ' Salvar na galeria';
          prev.innerHTML = '<img src="' + urls[0] + '" alt="Prévia da imagem">';
          document.getElementById('imgInfo').textContent = ultimoNome;
          return;
        }
        // várias páginas: cada uma com seu botão; o de baixo salva todas
        bc.style.display = ''; bc.lastChild.textContent = (win2() ? ' Copiar as ' : ' Compartilhar as ') + urls.length + ' páginas';
        bs.lastChild.textContent = ' Salvar as ' + urls.length + ' páginas';
        document.getElementById('imgInfo').textContent = urls.length + ' páginas · ' + ultimoNome;
        prev.innerHTML = urls.map(function (u, i) {
          return '<div class="pagImg"><div class="pagTopo"><b>Página ' + (i + 1) + ' de ' + urls.length + '</b><button class="pagBt" data-pg="' + i + '">' + (win2() ? 'Copiar' : 'Compartilhar') + '</button></div><img src="' + u + '" alt="Página ' + (i + 1) + '"></div>';
        }).join('');
      });
    }, 30);
  };
})();
