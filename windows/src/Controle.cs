using System;
using System.IO;
using System.Net;
using System.Text;

namespace Freedom
{
    /// <summary>
    /// Interruptor remoto do app, comandado pelo arquivo controle.json do repositório no GitHub
    /// (só quem pode fazer Push no repositório consegue mudar). Igual ao Controle.kt do Android:
    ///   { "bloqueado": false, "mensagem": "", "bloquear": ["email@..."], "versaoMinima": 0 }
    /// Sem internet, GitHub fora do ar ou arquivo sumido: mantém o último estado conhecido.
    /// </summary>
    public static class Controle
    {
        const string URL = "https://raw.githubusercontent.com/" + Atualizacao.REPO + "/main/controle.json";
        static Prefs P { get { return Prefs.De("controle"); } }

        /// <summary>Busca o controle.json (no máximo a cada 10 min, ou na hora com forcar).</summary>
        public static void Conferir(bool forcar)
        {
            long agora = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
            if (!forcar && agora - P.GetLong("hora") < 10 * 60 * 1000) return;
            try
            {
                var r = (HttpWebRequest)WebRequest.Create(URL + "?t=" + (agora / 60000));
                r.Timeout = 10000; r.UserAgent = "Freedom-Windows"; r.Headers["Cache-Control"] = "no-cache";
                using (var resp = (HttpWebResponse)r.GetResponse())
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    var txt = sr.ReadToEnd();
                    new JSONObject(txt);   // só guarda se for JSON válido
                    P.Edit().Put("json", txt).Put("hora", agora).Commit();
                }
            }
            catch (Exception) { }
        }

        /// <summary>null = liberado; senão {tipo: todos|usuario|versao, mensagem}.</summary>
        public static JSONObject Estado(string email = null)
        {
            var s = P.GetString("json"); if (s == null) return null;
            JSONObject o; try { o = new JSONObject(s); } catch (Exception) { return null; }
            var msg = (o.OptString("mensagem") ?? "").Trim();
            if (o.OptBoolean("bloqueado"))
                return new JSONObject().Put("tipo", "todos").Put("mensagem", msg.Length > 0 ? msg : "Este app foi desativado pela empresa.");
            var e = (email ?? Store.Email() ?? "").Trim().ToLowerInvariant();
            var lista = o.OptJSONArray("bloquear");
            if (e.Length > 0 && lista != null)
                for (int i = 0; i < lista.Length; i++)
                    if ((lista.OptString(i) ?? "").Trim().ToLowerInvariant() == e)
                        return new JSONObject().Put("tipo", "usuario").Put("mensagem", msg.Length > 0 ? msg : "O acesso deste login ao app foi desativado.");
            long min = NumeroPublicacao(o.OptString("versaoMinima"));
            int atual = Atualizacao.VersaoAtual();
            if (min > 0 && atual > 0 && atual < min)
                return new JSONObject().Put("tipo", "versao").Put("mensagem", "Esta versão do app não pode mais ser usada. Atualize para a versão " + o.OptString("versaoMinima") + " ou mais nova.");
            return null;
        }

        /// <summary>"3.4" -> número da publicação (3.0 = 21, cada versão +1, 3.10 -> 4.0); número sozinho já é a publicação.</summary>
        public static long NumeroPublicacao(string s)
        {
            s = (s ?? "").Trim(); if (s.Length == 0) return 0;
            var p = s.Split('.'); long maj, min = 0; double d;
            if (p.Length == 1) return double.TryParse(s, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out d) ? (long)d : 0;
            if (!long.TryParse(p[0], out maj) || maj < 3) return 0;
            long.TryParse(p[1], out min);
            return 21 + (maj - 3) * 11 + min;
        }

        /// <summary>Bloqueado e logado: apaga o que o app guardou (fila sem internet, avisos de meta). A tela sai da conta depois.</summary>
        public static bool PrecisaSair()
        {
            if (Estado() == null || !Store.Logado()) return false;
            try { Fila.Limpar(); } catch (Exception) { }
            try { Prefs.De("metas").Edit().Clear().Commit(); } catch (Exception) { }
            return true;
        }
    }
}
