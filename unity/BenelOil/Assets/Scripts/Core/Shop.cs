// BenelOil — inşaat kataloğu, bakım, başarımlar, satın-alma/satış (state.ts portu).
using System;
using System.Collections.Generic;
using System.Linq;
using static BenelOil.Core.Econ;

namespace BenelOil.Core
{
    public class ShopRow
    {
        public string id, icon, title, desc, stat, note;
        public int? cost;                 // null = maxed
        public string status;             // "buy" | "locked" | "maxed"
    }

    public class MaintRow
    {
        public string id, icon, title;
        public int cost;
        public bool urgent, disabled;
    }

    public static class Shop
    {
        public static List<ShopRow> GetShopItems(GameState s)
        {
            var rows = new List<ShopRow>();
            void Row(string id, string icon, string title, string stat, string desc, int? cost, string locked)
            {
                if (cost == null) rows.Add(new ShopRow { id = id, icon = icon, title = title, desc = desc, stat = stat, cost = null, status = "maxed", note = Loc.T("MAKS") });
                else if (locked != null) rows.Add(new ShopRow { id = id, icon = icon, title = title, desc = desc, stat = stat, cost = cost, status = "locked", note = locked });
                else rows.Add(new ShopRow { id = id, icon = icon, title = title, desc = desc, stat = stat, cost = cost, status = "buy", note = "" });
            }
            bool hasUnpaved = s.ownedParcels.Count > s.pavedParcels.Count;

            Row("land", "i-land", Loc.T("Arsa Satın Al ({0}/18)", s.ownedParcels.Count), Loc.T("2 blok 3×3"),
                Loc.T("Bitişik arsalardan birini seç — istasyon geliştikçe emlak fiyatları artar"),
                s.ownedParcels.Count >= 18 ? (int?)null : ParcelCost(0, s), null);
            Row("pave", "i-pave", Loc.T("Zemin Betonu"), Loc.T("arsa başı"),
                Loc.T("Çimen arsana beton döşe (yapı kurmak için şart, güneş paneli hariç)"),
                PaveCost, hasUnpaved ? null : Loc.T("Betonsuz arsan yok"));
            Row("pump", "i-fuel", Loc.T("Pompa #{0}", Math.Min(s.pumps + 1, MaxPumps)), Loc.T("+1 pompa"), Loc.T("Aynı anda bir müşteri daha alırsın"),
                s.pumps >= MaxPumps ? (int?)null : PumpCosts[s.pumps], null);
            Row("sign", "i-sign", Loc.T("Tabela Sv.{0}", Math.Min(s.signLevel + 1, 3)), Loc.T("+%10 trafik"), Loc.T("Yoldan geçenlerin uğrama şansı artar"),
                s.signLevel >= 3 ? (int?)null : SignCosts[s.signLevel], null);
            Row("widegate", "i-land", Loc.T("Geniş Giriş-Çıkış"), Loc.T("2 şerit"),
                Loc.T("Kapı ağızları genişler: araçlar ikili sıra girip çıkar, kuyruk yola taşmaz"),
                s.wideGates ? (int?)null : WidegateCost, s.pumps >= 2 ? null : Loc.T("Önce 2. pompayı al"));
            Row("tank", "i-tank", Loc.T("Yakıt Tankı"), s.tankLevel >= 3 ? $"{TankCapacity[3]}L" : $"{TankCapacity[s.tankLevel + 1]}L",
                Loc.T("Depo büyür, daha seyrek sipariş verirsin"),
                s.tankLevel >= 3 ? (int?)null : TankCosts[s.tankLevel], null);
            Row("airwater", "i-air", s.airWaterCount > 0 ? Loc.T("Hava-Su Ünitesi ({0})", s.airWaterCount) : Loc.T("Hava-Su Ünitesi"), "+₺10-20",
                Loc.T("Lastik havası ve su — ucuz ama müşteri çeker (sınırsız kurulur)"), AirwaterCost, null);
            Row("parking", "i-parking", s.parkingCount > 0 ? Loc.T("Otopark ({0})", s.parkingCount) : Loc.T("Otopark"), Loc.T("+4 araç"),
                Loc.T("Çizgili park alanı — müşteriler park edip tesisleri kullanır (sınırsız kurulur)"), ParkingCost, null);

            Row("market", "i-market", s.marketLevel == 0 ? Loc.T("Market") : Loc.T("Market Sv.2"), $"+₺{25 * (s.marketLevel + 1)}-{60 * (s.marketLevel + 1)}",
                Loc.T("Müşteriler ekstra alışveriş yapar"),
                s.marketLevel >= 2 ? (int?)null : MarketCosts[s.marketLevel], null);
            Row("toilet", "i-toilet", s.toiletLevel == 0 ? Loc.T("Tuvalet") : Loc.T("Tuvalet Sv.2"), Loc.T("+moral"),
                Loc.T("Müşteri memnuniyetini ve itibarı artırır"),
                s.toiletLevel >= 2 ? (int?)null : ToiletCosts[s.toiletLevel], null);
            Row("wash", "i-wash", Loc.T("Oto Yıkama"), "+₺60-120", Loc.T("Müşterilerin ~%25'i araç yıkatır, ekstra gelir"),
                s.hasWash ? (int?)null : WashCost, null);
            Row("oil", "i-oil", Loc.T("Yağ Değişimi"), "+₺150-250", Loc.T("Müşterilerin ~%12'si yağ değiştirtir, güçlü ek gelir"),
                s.hasOil ? (int?)null : OilCost, null);
            Row("selfwash", "i-selfwash", s.selfWashCount > 0 ? Loc.T("Self Yıkama ({0})", s.selfWashCount) : Loc.T("Self Yıkama"), "+₺30-60/dk",
                Loc.T("Araçlar kendisi yıkar; gelir kurulum sayısıyla artar (sınırsız)"), SelfwashCost, null);
            Row("coffee", "i-coffee", Loc.T("Kahveci"), "+₺20-45", Loc.T("Yolcular kahve molası verir"),
                s.hasCoffee ? (int?)null : CoffeeCost, null);
            Row("restaurant", "i-food", Loc.T("Restoran"), "+₺80-160", Loc.T("Uzun yol müşterisi yemek molası verir"),
                s.hasRestaurant ? (int?)null : RestaurantCost, null);
            Row("truckpark", "i-truck", Loc.T("Tır Parkı"), "+₺90-160/dk", Loc.T("Tırcılar konaklar — düzenli pasif gelir"),
                s.hasTruckPark ? (int?)null : TruckparkCost, null);

            Row("grid", "i-bolt", Loc.T("Elektrik Altyapısı Sv.{0}", Math.Min(s.gridLevel + 1, 2)),
                s.gridLevel == 0 ? Loc.T("temel") : Loc.T("+%30 üretim"),
                s.gridLevel == 0 ? Loc.T("Şarj ve enerji yapılarının önünü açar") : Loc.T("Tüm üretimi güçlendirir, yeni yapılar açılır"),
                s.gridLevel >= 2 ? (int?)null : GridCosts[s.gridLevel], null);
            Row("battery", "i-batt", Loc.T("Batarya Deposu Sv.{0}", Math.Min(s.batteryLevel + 1, 3)),
                $"{BatteryCap[Math.Min(s.batteryLevel + 1, 3)]} kWh",
                Loc.T("Üretilen elektriği biriktirir, araçlar buradan anında şarj olur"),
                s.batteryLevel >= 3 ? (int?)null : BatteryCosts[s.batteryLevel],
                s.gridLevel < 1 ? Loc.T("Elektrik altyapısı gerekli") : null);
            Row("evcharger", "i-charger", Loc.T("DC Şarj Ünitesi #{0}", Math.Min(s.evChargers + 1, MaxEv)), Loc.T("+1 ünite"),
                Loc.T("Elektrikli araç müşterileri gelmeye başlar; ünite arttıkça EV trafiği artar"),
                s.evChargers >= MaxEv ? (int?)null : EvCosts[s.evChargers],
                s.gridLevel < 1 ? Loc.T("Elektrik altyapısı gerekli")
                    : s.batteryLevel < 1 ? Loc.T("Önce batarya deposu kur") : null);
            Row("solar", "i-solar", s.solarCount > 0 ? Loc.T("Güneş Santrali ({0})", s.solarCount) : Loc.T("Güneş Santrali"), "+3 kWh/sn",
                Loc.T("Bedava üretim — ama kirlenir, düzenli temizlik ister (sınırsız kurulur)"),
                SolarCost, s.gridLevel < 1 ? Loc.T("Elektrik altyapısı gerekli") : null);
            Row("dieselgen", "i-gen", Loc.T("Dizel Jeneratör"), Loc.T("+7 kWh/sn"),
                Loc.T("Tanktan mazot yakar — gürültüsü şarjdaki müşterileri kaçırır"),
                s.hasDiesel ? (int?)null : DieselgenCost, s.gridLevel < 1 ? Loc.T("Elektrik altyapısı gerekli") : null);
            Row("smr", "i-reactor", Loc.T("Modüler Reaktör"), Loc.T("+15 kWh/sn"),
                Loc.T("Dev üretim — bakımsız kalırsa PATLAR, her şey sıfırlanır"),
                s.hasSMR ? (int?)null : SmrCost, s.gridLevel < 2 ? Loc.T("Altyapı Sv.2 gerekli") : null);

            return rows;
        }

        public static List<MaintRow> GetMaintenanceItems(GameState s)
        {
            var rows = new List<MaintRow>();
            if (s.hasSolar)
                rows.Add(new MaintRow { id = "clean-solar", icon = "i-clean",
                    title = Loc.T("Panel Temizliği (kir %{0})", (int)Math.Round(s.solarDirt * 100)),
                    cost = 300, urgent = s.solarDirt > 0.6f, disabled = s.solarDirt < 0.15f });
            if (s.hasSMR)
            {
                rows.Add(new MaintRow { id = "maint-smr", icon = "i-reactor",
                    title = Loc.T("Reaktör Bakımı (yıpranma %{0})", (int)Math.Round(s.smrWear * 100)),
                    cost = 1500, urgent = s.smrWear > 0.6f, disabled = s.smrWear < 0.1f });
                rows.Add(new MaintRow { id = "order-uranium", icon = "i-uranium",
                    title = s.uraniumPending ? $"Uranyum yolda ({(int)Math.Ceiling(s.uraniumEta)}sn)" : Loc.T("Uranyum Siparişi (%{0} kaldı)", (int)Math.Round(s.uranium)),
                    cost = UraniumCost, urgent = s.uranium <= 15 && !s.uraniumPending, disabled = s.uraniumPending || s.uranium > 60 });
            }
            foreach (var i in s.brokenPumps)
                rows.Add(new MaintRow { id = $"fix-pump-{i}", icon = "i-wrench", title = Loc.T("Pompa #{0} Tamiri", i + 1), cost = 800, urgent = true, disabled = false });
            foreach (var i in s.brokenChargers)
                rows.Add(new MaintRow { id = $"fix-charger-{i}", icon = "i-wrench", title = Loc.T("Şarj #{0} Tamiri", i + 1), cost = 1000, urgent = true, disabled = false });
            return rows;
        }

        /// <summary>Satın alma dener; başarılıysa true. Görsel güncellemeleri çağıran taraf yapar.</summary>
        public static bool BuyItem(GameState s, string id)
        {
            var item = GetShopItems(s).FirstOrDefault(r => r.id == id);
            if (item == null || item.status != "buy" || item.cost == null || s.money < item.cost) return false;
            s.money -= item.cost.Value;
            switch (id)
            {
                case "pump": s.pumps++; break;
                case "sign": s.signLevel++; break;
                case "widegate": s.wideGates = true; break;
                case "tank": s.tankLevel++; break;
                case "market": s.marketLevel++; break;
                case "toilet": s.toiletLevel++; break;
                case "grid": s.gridLevel++; break;
                case "battery": s.batteryLevel++; break;
                case "evcharger": s.evChargers++; break;
                case "solar": s.solarCount++; break;
                case "dieselgen": s.hasDiesel = true; break;
                case "smr": s.hasSMR = true; s.uranium = 100; break;
                case "wash": s.hasWash = true; break;
                case "oil": s.hasOil = true; break;
                case "coffee": s.hasCoffee = true; break;
                case "restaurant": s.hasRestaurant = true; break;
                case "truckpark": s.hasTruckPark = true; break;
                case "airwater": s.airWaterCount++; break;
                case "selfwash": s.selfWashCount++; break;
                case "parking": s.parkingCount++; break;
                default: return false;
            }
            return true;
        }

        /// <summary>Satılabilir mi + iade tutarı (mutasyon yapmaz). null = satılamaz.</summary>
        public static int? SellInfo(GameState s, string id)
        {
            string bas = id.Split('#')[0];
            int inst = id.Contains('#') ? int.Parse(id.Split('#')[1]) : 0;
            int Half(int c) => (int)Math.Round(c * SellRefund);
            if (bas == "pump")
            {
                int i = int.Parse(id.Substring(5));
                if (s.pumps <= 1 || i != s.pumps - 1) return null;
                return Half(PumpCosts[s.pumps - 1]);
            }
            if (bas == "charger")
            {
                int i = int.Parse(id.Substring(8));
                if (s.evChargers <= 0 || i != s.evChargers - 1) return null;
                return Half(EvCosts[s.evChargers - 1]);
            }
            switch (bas)
            {
                case "market": return s.marketLevel > 0 ? Half(MarketCosts.Take(s.marketLevel).Sum()) : (int?)null;
                case "toilet": return s.toiletLevel > 0 ? Half(ToiletCosts.Take(s.toiletLevel).Sum()) : (int?)null;
                case "battery": return s.batteryLevel > 0 ? Half(BatteryCosts.Take(s.batteryLevel).Sum()) : (int?)null;
                case "wash": return s.hasWash ? Half(WashCost) : (int?)null;
                case "oil": return s.hasOil ? Half(OilCost) : (int?)null;
                case "coffee": return s.hasCoffee ? Half(CoffeeCost) : (int?)null;
                case "restaurant": return s.hasRestaurant ? Half(RestaurantCost) : (int?)null;
                case "truckpark": return s.hasTruckPark ? Half(TruckparkCost) : (int?)null;
                case "dieselgen": return s.hasDiesel ? Half(DieselgenCost) : (int?)null;
                case "smr": return s.hasSMR ? Half(SmrCost) : (int?)null;
                case "solar": return s.solarCount > 0 && inst == s.solarCount - 1 ? Half(SolarCost) : (int?)null;
                case "parking": return s.parkingCount > 0 && inst == s.parkingCount - 1 ? Half(ParkingCost) : (int?)null;
                case "selfwash": return s.selfWashCount > 0 && inst == s.selfWashCount - 1 ? Half(SelfwashCost) : (int?)null;
                case "airwater": return s.airWaterCount > 0 && inst == s.airWaterCount - 1 ? Half(AirwaterCost) : (int?)null;
                default: return null;
            }
        }

        /// <summary>Satışı uygula: sayaç/bayrakları düşür, iadeyi ekle. Görsel kaldırma çağıranda.</summary>
        public static int? ApplySell(GameState s, string id)
        {
            var info = SellInfo(s, id);
            if (info == null) return null;
            string bas = id.Split('#')[0];
            s.money += info.Value;
            if (bas == "pump") { int i = s.pumps - 1; s.pumps--; s.brokenPumps.Remove(i); s.autoPumps.Remove(i); }
            else if (bas == "charger") { int i = s.evChargers - 1; s.evChargers--; s.brokenChargers.Remove(i); s.autoChargers.Remove(i); }
            else switch (bas)
            {
                case "market": s.marketLevel = 0; break;
                case "toilet": s.toiletLevel = 0; break;
                case "battery": s.batteryLevel = 0; s.battery = 0; break;
                case "wash": s.hasWash = false; break;
                case "oil": s.hasOil = false; break;
                case "coffee": s.hasCoffee = false; break;
                case "restaurant": s.hasRestaurant = false; break;
                case "truckpark": s.hasTruckPark = false; break;
                case "dieselgen": s.hasDiesel = false; break;
                case "smr": s.hasSMR = false; s.uranium = 0; s.smrWear = 0; break;
                case "solar": s.solarCount--; break;
                case "parking": s.parkingCount--; break;
                case "selfwash": s.selfWashCount--; break;
                case "airwater": s.airWaterCount--; break;
            }
            return info;
        }

        static readonly (string id, string title, Func<GameState, bool> cond)[] Achievements =
        {
            ("first-10k", "İlk ₺10.000 — Esnaf oldun!", s => s.money >= 10000),
            ("rich-100k", "₺100.000 — Patron!", s => s.money >= 100000),
            ("five-star", "5 yıldız itibar — Efsane istasyon!", s => s.reputation >= 4.95f),
            ("full-pumps", "4 pompa — Tam kadro!", s => s.pumps >= 4),
            ("electric-age", "Elektrik çağı — İlk şarj ünitesi!", s => s.evChargers >= 1),
            ("atomic", "Atom karıncası — Reaktör kuruldu!", s => s.hasSMR),
            ("landlord", "Toprak ağası — 9 arsanın tamamı!", s => s.ownedParcels.Count >= 9),
            ("week-one", "7. gün — Bir haftadır ayaktasın!", s => s.day >= 7),
        };

        public static void CheckAchievements(GameState s)
        {
            foreach (var (id, title, cond) in Achievements)
                if (!s.achievements.Contains(id) && cond(s))
                {
                    s.achievements.Add(id);
                    s.events.Add(Loc.T("🏆 Başarım: {0}", Loc.T(title)));
                }
        }
    }
}
