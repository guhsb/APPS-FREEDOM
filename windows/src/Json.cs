using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Freedom
{
    /// <summary>Valor null do JSON (igual ao JSONObject.NULL do Android).</summary>
    public sealed class JNull
    {
        public static readonly JNull Valor = new JNull();
        private JNull() { }
        public override string ToString() { return "null"; }
    }

    /// <summary>Objeto JSON com a mesma "cara" do org.json do Android, para o código ficar igual nos dois apps.</summary>
    public sealed class JSONObject
    {
        public static readonly object NULL = JNull.Valor;
        private readonly List<string> ordem = new List<string>();
        private readonly Dictionary<string, object> m = new Dictionary<string, object>();

        public JSONObject() { }

        public JSONObject(string texto)
        {
            var p = new JsonParser(texto);
            var o = p.Ler() as JSONObject;
            if (o == null) throw new FormatException("JSON não é um objeto");
            foreach (var k in o.ordem) Put(k, o.m[k]);
        }

        public int Length { get { return ordem.Count; } }
        public IEnumerable<string> Keys { get { return ordem.ToArray(); } }
        public bool Has(string k) { return m.ContainsKey(k); }
        public bool IsNull(string k) { object v; return !m.TryGetValue(k, out v) || v == null || v is JNull; }
        public object Opt(string k) { object v; return m.TryGetValue(k, out v) ? v : null; }

        public JSONObject Put(string k, object v)
        {
            if (v == null) v = JNull.Valor;
            if (!m.ContainsKey(k)) ordem.Add(k);
            m[k] = v;
            return this;
        }

        public JSONObject Remove(string k)
        {
            if (m.Remove(k)) ordem.Remove(k);
            return this;
        }

        public string OptString(string k, string padrao = "")
        {
            object v = Opt(k);
            if (v == null || v is JNull) return padrao;
            return Json.ComoTexto(v);
        }

        public int OptInt(string k, int padrao = 0) { long? l = Json.ComoLong(Opt(k)); return l.HasValue ? (int)l.Value : padrao; }
        public long OptLong(string k, long padrao = 0) { long? l = Json.ComoLong(Opt(k)); return l.HasValue ? l.Value : padrao; }
        public double OptDouble(string k, double padrao = double.NaN) { double? d = Json.ComoDouble(Opt(k)); return d.HasValue ? d.Value : padrao; }

        public bool OptBoolean(string k, bool padrao = false)
        {
            object v = Opt(k);
            if (v is bool) return (bool)v;
            var s = v as string;
            if (s != null) { if (s.Equals("true", StringComparison.OrdinalIgnoreCase)) return true; if (s.Equals("false", StringComparison.OrdinalIgnoreCase)) return false; }
            return padrao;
        }

        public JSONObject OptJSONObject(string k) { return Opt(k) as JSONObject; }
        public JSONArray OptJSONArray(string k) { return Opt(k) as JSONArray; }

        public JSONObject Copia() { return new JSONObject(ToString()); }

        public override string ToString()
        {
            var sb = new StringBuilder();
            Escrever(sb);
            return sb.ToString();
        }

        internal void Escrever(StringBuilder sb)
        {
            sb.Append('{');
            bool primeiro = true;
            foreach (var k in ordem)
            {
                if (!primeiro) sb.Append(',');
                primeiro = false;
                Json.Citar(sb, k);
                sb.Append(':');
                Json.EscreverValor(sb, m[k]);
            }
            sb.Append('}');
        }

        public static string Quote(string s)
        {
            var sb = new StringBuilder();
            Json.Citar(sb, s ?? "");
            return sb.ToString();
        }
    }

    public sealed class JSONArray
    {
        private readonly List<object> l = new List<object>();

        public JSONArray() { }

        public JSONArray(string texto)
        {
            var p = new JsonParser(texto);
            var a = p.Ler() as JSONArray;
            if (a == null) throw new FormatException("JSON não é uma lista");
            l.AddRange(a.l);
        }

        public int Length { get { return l.Count; } }
        public object Opt(int i) { return i >= 0 && i < l.Count ? l[i] : null; }
        public object Get(int i) { return l[i]; }
        public JSONArray Put(object v) { l.Add(v ?? JNull.Valor); return this; }
        public JSONObject OptJSONObject(int i) { return Opt(i) as JSONObject; }
        public JSONArray OptJSONArray(int i) { return Opt(i) as JSONArray; }
        public string OptString(int i, string padrao = "") { object v = Opt(i); return v == null || v is JNull ? padrao : Json.ComoTexto(v); }
        public long OptLong(int i, long padrao = 0) { long? x = Json.ComoLong(Opt(i)); return x.HasValue ? x.Value : padrao; }

        public override string ToString()
        {
            var sb = new StringBuilder();
            Escrever(sb);
            return sb.ToString();
        }

        internal void Escrever(StringBuilder sb)
        {
            sb.Append('[');
            for (int i = 0; i < l.Count; i++)
            {
                if (i > 0) sb.Append(',');
                Json.EscreverValor(sb, l[i]);
            }
            sb.Append(']');
        }
    }

    internal static class Json
    {
        internal static string ComoTexto(object v)
        {
            if (v is string) return (string)v;
            if (v is bool) return (bool)v ? "true" : "false";
            if (v is double || v is float || v is decimal)
            {
                double d = Convert.ToDouble(v, CultureInfo.InvariantCulture);
                if (d == Math.Floor(d) && Math.Abs(d) < 1e15) return ((long)d).ToString(CultureInfo.InvariantCulture);
                return d.ToString("R", CultureInfo.InvariantCulture);
            }
            if (v is IConvertible) return Convert.ToString(v, CultureInfo.InvariantCulture);
            return v.ToString();
        }

        internal static long? ComoLong(object v)
        {
            if (v == null || v is JNull) return null;
            if (v is long) return (long)v;
            if (v is int) return (int)v;
            if (v is double || v is float || v is decimal) return (long)Convert.ToDouble(v, CultureInfo.InvariantCulture);
            var s = v as string;
            if (s != null)
            {
                long l;
                if (long.TryParse(s.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out l)) return l;
                double d;
                if (double.TryParse(s.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return (long)d;
            }
            return null;
        }

        internal static double? ComoDouble(object v)
        {
            if (v == null || v is JNull) return null;
            if (v is long || v is int || v is double || v is float || v is decimal) return Convert.ToDouble(v, CultureInfo.InvariantCulture);
            var s = v as string;
            double d;
            if (s != null && double.TryParse(s.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return d;
            return null;
        }

        internal static void Citar(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '/': sb.Append("\\/"); break;          // evita "</script>" dentro de código
                    case (char)0x2028: sb.Append("\\u2028"); break; // quebras que o JavaScript não aceita em texto
                    case (char)0x2029: sb.Append("\\u2029"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        internal static void EscreverValor(StringBuilder sb, object v)
        {
            if (v == null || v is JNull) { sb.Append("null"); return; }
            var o = v as JSONObject; if (o != null) { o.Escrever(sb); return; }
            var a = v as JSONArray; if (a != null) { a.Escrever(sb); return; }
            if (v is string) { Citar(sb, (string)v); return; }
            if (v is bool) { sb.Append((bool)v ? "true" : "false"); return; }
            if (v is double || v is float || v is decimal)
            {
                double d = Convert.ToDouble(v, CultureInfo.InvariantCulture);
                if (double.IsNaN(d) || double.IsInfinity(d)) { sb.Append('0'); return; }
                sb.Append(ComoTexto(d));
                return;
            }
            if (v is IConvertible) { sb.Append(Convert.ToString(v, CultureInfo.InvariantCulture)); return; }
            Citar(sb, v.ToString());
        }
    }

    /// <summary>Leitor de JSON simples (o .NET Framework não traz um pronto).</summary>
    internal sealed class JsonParser
    {
        private readonly string s;
        private int i;

        public JsonParser(string texto) { s = texto ?? ""; }

        public object Ler()
        {
            Espaco();
            object v = Valor();
            Espaco();
            if (i < s.Length) throw Erro("texto sobrando");
            return v;
        }

        private FormatException Erro(string m) { return new FormatException("JSON inválido (" + m + ") na posição " + i); }

        private void Espaco() { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }

        private object Valor()
        {
            if (i >= s.Length) throw Erro("fim inesperado");
            char c = s[i];
            if (c == '{') return Objeto();
            if (c == '[') return Lista();
            if (c == '"') return Texto();
            if (c == 't' && Pula("true")) return true;
            if (c == 'f' && Pula("false")) return false;
            if (c == 'n' && Pula("null")) return JNull.Valor;
            return Numero();
        }

        private bool Pula(string w)
        {
            if (string.CompareOrdinal(s, i, w, 0, w.Length) == 0) { i += w.Length; return true; }
            throw Erro("palavra desconhecida");
        }

        private JSONObject Objeto()
        {
            var o = new JSONObject();
            i++;
            Espaco();
            if (i < s.Length && s[i] == '}') { i++; return o; }
            while (true)
            {
                Espaco();
                if (i >= s.Length || s[i] != '"') throw Erro("esperava nome");
                string k = Texto();
                Espaco();
                if (i >= s.Length || s[i] != ':') throw Erro("esperava ':'");
                i++;
                Espaco();
                o.Put(k, Valor());
                Espaco();
                if (i < s.Length && s[i] == ',') { i++; continue; }
                if (i < s.Length && s[i] == '}') { i++; return o; }
                throw Erro("esperava ',' ou '}'");
            }
        }

        private JSONArray Lista()
        {
            var a = new JSONArray();
            i++;
            Espaco();
            if (i < s.Length && s[i] == ']') { i++; return a; }
            while (true)
            {
                Espaco();
                a.Put(Valor());
                Espaco();
                if (i < s.Length && s[i] == ',') { i++; continue; }
                if (i < s.Length && s[i] == ']') { i++; return a; }
                throw Erro("esperava ',' ou ']'");
            }
        }

        private string Texto()
        {
            var sb = new StringBuilder();
            i++;
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                if (i >= s.Length) break;
                char e = s[i++];
                switch (e)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u':
                        if (i + 4 > s.Length) throw Erro("\\u incompleto");
                        sb.Append((char)Convert.ToInt32(s.Substring(i, 4), 16));
                        i += 4;
                        break;
                    default: throw Erro("escape inválido");
                }
            }
            throw Erro("texto sem fim");
        }

        private object Numero()
        {
            int ini = i;
            if (i < s.Length && (s[i] == '-' || s[i] == '+')) i++;
            while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '.' || s[i] == 'e' || s[i] == 'E' || s[i] == '-' || s[i] == '+')) i++;
            string t = s.Substring(ini, i - ini);
            if (t.Length == 0) throw Erro("valor inválido");
            long l;
            if (t.IndexOfAny(new[] { '.', 'e', 'E' }) < 0 && long.TryParse(t, NumberStyles.Integer, CultureInfo.InvariantCulture, out l)) return l;
            double d;
            if (double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return d;
            throw Erro("número inválido");
        }
    }
}
