// BenelOil — ekonomi sabitleri ve yardımcılar (state.ts portu, saf C#, Unity'den bağımsız).
// Motor-bağımsız tutulur: GameState + bu sabitler hiçbir UnityEngine tipine dokunmaz,
// böylece birim testi yapılabilir ve mantık web sürümüyle birebir kalır.
using System;
using System.Collections.Generic;

namespace BenelOil.Core
{
    public enum Fuel { Benzin, Dizel, Lpg }

    public static class Econ
    {
        public static readonly Fuel[] Fuels = { Fuel.Benzin, Fuel.Dizel, Fuel.Lpg };

        // fiyat/maliyet (₺/L)
        public static readonly Dictionary<Fuel, float> FuelPrice = new() { { Fuel.Benzin, 10 }, { Fuel.Dizel, 9 }, { Fuel.Lpg, 6 } };
        public static readonly Dictionary<Fuel, float> FuelCost  = new() { { Fuel.Benzin, 6.5f }, { Fuel.Dizel, 6 }, { Fuel.Lpg, 4 } };

        public const int   StartMoney         = 5000;
        public const float OrderEta           = 25f;   // sn
        public const float FillRate           = 7f;    // L/sn
        public const float SpillPenaltyPerL   = 3f;
        public const int   WrongFuelPenalty   = 300;

        public static readonly int[] TankCapacity = { 800, 1500, 3000, 5000 };
        public const int MaxPumps = 8;
        public const int MaxEv    = 8;
        public static readonly int[] BatteryCap = { 0, 100, 250, 600 };
        public const float EvPricePerKwh    = 8f;
        public const float GridCostPerKwh   = 3.5f;
        public const float DieselGenFuelPerS = 0.25f;

        public static readonly int[] PumpCosts   = { 0, 5000, 8000, 12000, 16000, 21000, 26000, 32000 };
        public static readonly int[] SignCosts   = { 1500, 4000, 9000 };
        public const int WidegateCost = 6000;
        public const int PompaciHire  = 800;   // pompacı işe alma (pompa başı, bir kez)
        public const int PompaciFee   = 12;    // satış başına ücret; bahşiş pompacıya kalır
        public static readonly int[] TankCosts    = { 3000, 7000, 15000 };
        public static readonly int[] MarketCosts  = { 7000, 12000 };
        public static readonly int[] ToiletCosts  = { 2500, 5000 };
        public static readonly int[] GridCosts    = { 8000, 15000 };
        public static readonly int[] BatteryCosts = { 5000, 9000, 16000 };
        public static readonly int[] EvCosts      = { 6000, 10000, 14000, 18000, 22000, 27000, 32000, 38000 };
        public const int SolarCost     = 9000;
        public const int DieselgenCost = 4000;
        public const int SmrCost       = 40000;
        public const int WashCost      = 8000;
        public const int OilCost       = 12000;
        public const int CoffeeCost    = 7000;
        public const int RestaurantCost= 15000;
        public const int TruckparkCost = 12000;
        public const int AirwaterCost  = 1500;
        public const int SelfwashCost  = 6000;
        public const int ParkingCost   = 1200;
        public const int PaveCost      = 2500;
        public const int UraniumCost   = 2500;
        public const float UraniumEta  = 20f;
        public const float UraniumDrainPerS = 100f / 300f; // tam yük ~5 dk

        public const float SellRefund = 0.5f; // yıkımda yatırımın yarısı geri döner

        // Arsa haritası: kolon 0 istasyon; 1-2 batı; 3-5 yol karşısı (doğu). Satır 0 güney,1 orta,2 kuzey.
        public static readonly (float, float)[] ParcelCols =
        {
            (-6.5f, 5f), (-18f, -6.5f), (-29.5f, -18f),
            (10.9f, 22.4f), (22.4f, 33.9f), (33.9f, 45.4f),
        };
        public static readonly (float, float)[] ParcelRows = { (-24f, -10f), (-10f, 10f), (10f, 24f) };

        public static string ParcelKey(int c, int r) => $"{c},{r}";

        public static (float lo, float hi) PriceBounds(Fuel f)
            => ((float)Math.Ceiling(FuelCost[f]), (float)Math.Round(FuelCost[f] * 2.2f));

        public static int ParcelCost(int c, GameState s = null)
        {
            int b = c == 0 ? 6000 : (c == 1 || c == 3) ? 9000 : 14000;
            if (s == null) return b;
            float mult = Math.Min(1f + 0.12f * s.DevelopmentScore(), 2f);
            return (int)Math.Round(b * mult / 100f) * 100;
        }

        public static bool ParcelsAdjacent(int c1, int r1, int c2, int r2)
        {
            if (r1 == r2)
            {
                bool sameBlock = (c1 < 3) == (c2 < 3);
                if (sameBlock && Math.Abs(c1 - c2) == 1) return true;
                if ((c1 == 0 && c2 == 3) || (c1 == 3 && c2 == 0)) return true; // yol karşısı
            }
            if (c1 == c2 && Math.Abs(r1 - r2) == 1) return true;
            return false;
        }

        // deterministik olmayan rastgelelik — web'deki Math.random() karşılığı
        static readonly Random _rng = new();
        public static double Rand() => _rng.NextDouble();
    }
}
