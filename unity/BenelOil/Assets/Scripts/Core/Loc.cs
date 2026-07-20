// BenelOil — i18n (i18n.ts portu). TR anahtar → EN değer; eksikse TR'ye düşer.
// Tam sözlük UI portuyla doldurulacak; şimdilik anahtar = TR metin, {0} biçimlendirme destekli.
using System.Collections.Generic;

namespace BenelOil.Core
{
    public static class Loc
    {
        public enum Lang { Tr, En }
        public static Lang Current = Lang.Tr;

        // EN sözlüğü UI portunda i18n.ts'ten aktarılacak. Boşken TR anahtar döner.
        static readonly Dictionary<string, string> En = new();

        public static string T(string key, params object[] args)
        {
            string s = (Current == Lang.En && En.TryGetValue(key, out var v)) ? v : key;
            if (args != null && args.Length > 0)
                for (int i = 0; i < args.Length; i++)
                    s = s.Replace("{" + i + "}", args[i]?.ToString() ?? "");
            return s;
        }

        public static void LoadEn(Dictionary<string, string> dict)
        {
            En.Clear();
            foreach (var kv in dict) En[kv.Key] = kv.Value;
        }
    }
}
