// BenelOil — oyun durumu + ekonomi simülasyonu (state.ts portu). Saf C#, Unity'den bağımsız.
using System;
using System.Collections.Generic;
using System.Linq;
using static BenelOil.Core.Econ;

namespace BenelOil.Core
{
    public class OrderState
    {
        public bool pending, arrived, delivering;
        public float eta;
    }

    public class GameState
    {
        public float money = StartMoney;
        public float reputation = 3.0f;
        public string stationName = Loc.T("BENELOIL");
        public Dictionary<Fuel, float> prices = new() { { Fuel.Benzin, FuelPrice[Fuel.Benzin] }, { Fuel.Dizel, FuelPrice[Fuel.Dizel] }, { Fuel.Lpg, FuelPrice[Fuel.Lpg] } };

        public Dictionary<Fuel, float> tanks = new() { { Fuel.Benzin, 250 }, { Fuel.Dizel, 150 }, { Fuel.Lpg, 100 } };
        public Dictionary<Fuel, OrderState> orders = new()
        {
            { Fuel.Benzin, new OrderState() }, { Fuel.Dizel, new OrderState() }, { Fuel.Lpg, new OrderState() },
        };

        public int pumps = 1, signLevel = 0, tankLevel = 0, marketLevel = 0, toiletLevel = 0;
        public int gridLevel = 0, evChargers = 0, batteryLevel = 0;
        public float elecPrice = EvPricePerKwh;
        public float toiletFee = 0;
        public HashSet<int> autoChargers = new();
        public HashSet<int> autoPumps = new();
        public bool wideGates = false;
        public Dictionary<string, float> facDaily = new();
        public Dictionary<string, float> facTotal = new();

        public int statServed = 0, statLost = 0;
        public float statKwh = 0, statRevenue = 0;
        public Dictionary<Fuel, float> statLiters = new() { { Fuel.Benzin, 0 }, { Fuel.Dizel, 0 }, { Fuel.Lpg, 0 } };

        public float battery = 0;
        public int solarCount = 0;
        public bool hasSolar => solarCount > 0;
        public bool hasDiesel, hasSMR, hasWash, hasOil, hasCoffee, hasRestaurant, hasTruckPark;
        public int airWaterCount = 0, selfWashCount = 0, parkingCount = 0;
        public bool hasAirWater => airWaterCount > 0;
        public bool hasSelfWash => selfWashCount > 0;
        public bool hasParking => parkingCount > 0;
        public bool closed = false;
        public Dictionary<string, float> pendingCash = new();
        float truckTimer = 45, selfWashTimer = 30;

        public HashSet<string> ownedParcels = new() { ParcelKey(0, 1) };
        public HashSet<string> pavedParcels = new() { ParcelKey(0, 1) };

        public int day = 1;
        public float dayStartMoney = StartMoney;
        public HashSet<string> achievements = new();
        public string lastLoginDate = "", dailyDate = "";
        public int loginStreak = 0, dailyServed = 0;
        public bool dailyDone = false;

        public string promoType = null; // "cheapFuel" | "rush" | null
        public double promoUntil = 0;    // epoch ms
        float promoTimer = 150;

        public float solarDirt = 0, smrWear = 0, maintCare = 0;
        public float uranium = 0;
        public bool uraniumPending = false;
        public float uraniumEta = 0;
        public HashSet<int> brokenPumps = new();
        public HashSet<int> brokenChargers = new();
        public List<string> events = new();
        public bool exploded = false;

        public int tankCapacity => TankCapacity[tankLevel];
        public int batteryCapacity => BatteryCap[batteryLevel];

        public bool owns(int c, int r) => ownedParcels.Contains(ParcelKey(c, r));
        public bool isPaved(int c, int r) => pavedParcels.Contains(ParcelKey(c, r));
        public bool landSouth => pavedParcels.Contains(ParcelKey(0, 0));
        public bool landNorth => pavedParcels.Contains(ParcelKey(0, 2));
        public bool anyLand => ownedParcels.Count > 1;
        public bool graceActive => day <= 2;

        // now() enjekte edilir (Unity tarafı Time'dan besler) — saf mantık epoch bilmez
        public static Func<double> NowMs = () => 0;

        public int DevelopmentScore()
        {
            int flags = new[] { hasSolar, hasDiesel, hasSMR, hasWash, hasOil, hasCoffee,
                                hasRestaurant, hasTruckPark, hasAirWater, hasSelfWash, hasParking }.Count(b => b);
            return (pumps - 1) + evChargers + signLevel + tankLevel
                 + marketLevel + toiletLevel + gridLevel + batteryLevel + flags;
        }

        public bool ParcelAdjacentToOwned(int c, int r)
        {
            foreach (var key in ownedParcels)
            {
                var p = key.Split(','); int oc = int.Parse(p[0]), or = int.Parse(p[1]);
                if (ParcelsAdjacent(c, r, oc, or)) return true;
            }
            return false;
        }

        public float EvPriceFactor()
        {
            float r = (elecPrice - EvPricePerKwh) / EvPricePerKwh;
            return Math.Min(1.25f, Math.Max(0.5f, 1.05f - 0.55f * r));
        }

        public bool DieselRunning()
            => hasDiesel && tanks[Fuel.Dizel] > 0 && batteryLevel > 0 && battery < batteryCapacity - 0.01f;

        public float GridRate() => gridLevel >= 1 ? 2f * (gridLevel >= 2 ? 1.3f : 1f) : 0f;

        public float GenRate()
        {
            float r = 0;
            if (gridLevel >= 1) r += 2;
            if (solarCount > 0) r += 3 * solarCount * (1 - 0.7f * solarDirt);
            if (DieselRunning()) r += 7;
            if (hasSMR && uranium > 0) r += 15;
            if (gridLevel >= 2) r *= 1.3f;
            return r;
        }

        public void Tick(float dt)
        {
            foreach (var f in Fuels)
            {
                var o = orders[f];
                if (o.pending)
                {
                    o.eta -= dt;
                    if (o.eta <= 0) { o.pending = false; o.arrived = true; }
                }
            }
            if (batteryLevel > 0 && battery < batteryCapacity)
            {
                float before = battery, total = GenRate();
                battery = Math.Min(batteryCapacity, battery + total * dt);
                float added = battery - before;
                if (added > 0 && total > 0)
                    money -= added * Math.Min(1f, GridRate() / total) * GridCostPerKwh;
                if (DieselRunning())
                    tanks[Fuel.Dizel] = Math.Max(0, tanks[Fuel.Dizel] - DieselGenFuelPerS * dt);
            }
            if (hasSolar && solarDirt < 1)
            {
                float before = solarDirt;
                solarDirt = Math.Min(1, solarDirt + 0.0045f * dt);
                if (before < 0.6f && solarDirt >= 0.6f) events.Add(Loc.T("🧽 Güneş panelleri iyice kirlendi, üretim düşüyor!"));
            }
            if (uraniumPending)
            {
                uraniumEta -= dt;
                if (uraniumEta <= 0) { uraniumPending = false; uranium = 100; events.Add(Loc.T("☢️ Uranyum teslim edildi — reaktör tam güçte!")); }
            }
            if (hasSMR && uranium > 0 && batteryLevel > 0 && battery < batteryCapacity)
            {
                float before = uranium;
                uranium = Math.Max(0, uranium - UraniumDrainPerS * dt);
                if (before > 20 && uranium <= 20) events.Add(Loc.T("☢️ Uranyum azalıyor! Yeni çubuk sipariş et."));
                if (before > 0 && uranium == 0) events.Add(Loc.T("🚨 Uranyum bitti — reaktör üretimi DURDU!"));
            }
            if (hasSMR)
            {
                float before = smrWear;
                smrWear = Math.Min(1, smrWear + 0.004f * dt);
                if (before < 0.5f && smrWear >= 0.5f) events.Add(Loc.T("☢️ Reaktör bakım istiyor!"));
                if (before < 0.75f && smrWear >= 0.75f) events.Add(Loc.T("🚨 REAKTÖR KRİTİK! Hemen bakım yap yoksa patlayacak!"));
                if (smrWear > 0.7f && Rand() < dt * 0.012f * (smrWear - 0.7f) / 0.3f) exploded = true;
            }
            double now = NowMs();
            if (promoType != null && now > promoUntil)
            {
                events.Add(promoType == "cheapFuel" ? Loc.T("Yakıt indirimi sona erdi.") : Loc.T("Müşteri patlaması sona erdi."));
                promoType = null;
            }
            if (promoType == null)
            {
                promoTimer -= dt;
                if (promoTimer <= 0)
                {
                    promoTimer = 240 + (float)Rand() * 120;
                    promoType = Rand() < 0.5 ? "cheapFuel" : "rush";
                    promoUntil = now + 60_000;
                    events.Add(promoType == "cheapFuel"
                        ? Loc.T("FIRSAT: 60 saniye boyunca yakıt siparişi YARI FİYAT!")
                        : Loc.T("FIRSAT: 60 saniye müşteri patlaması — pompalara koş!"));
                }
            }
            if (hasTruckPark)
            {
                truckTimer -= dt;
                if (truckTimer <= 0) { truckTimer = 35 + (float)Rand() * 20; AddPending("truckpark", 90 + (int)(Rand() * 70), Loc.T("Tır parkı")); }
            }
            if (hasSelfWash)
            {
                selfWashTimer -= dt;
                if (selfWashTimer <= 0) { selfWashTimer = 25 + (float)Rand() * 20; AddPending("selfwash", (30 + (int)(Rand() * 30)) * selfWashCount, Loc.T("Self yıkama")); }
            }
            maintCare = Math.Max(0, maintCare - 0.0004f * dt);

            int stress = graceActive ? 1 : money < 1000 ? 3 : money < 3000 ? 2 : 1;
            float care = 1 - 0.65f * maintCare;
            int brokenCount = brokenPumps.Count + brokenChargers.Count;
            if (brokenCount < 2)
            {
                for (int i = 0; i < pumps; i++)
                    if (!brokenPumps.Contains(i) && Rand() < (dt / 3600f) * stress * care)
                    { brokenPumps.Add(i); events.Add(Loc.T("🔧 Pompa #{0} arıza yaptı! Üstüne tıklayıp karttan tamir et.", i + 1)); break; }
                for (int i = 0; i < evChargers; i++)
                    if (!brokenChargers.Contains(i) && Rand() < (dt / 4200f) * stress * care)
                    { brokenChargers.Add(i); events.Add(Loc.T("🔌 Şarj ünitesi #{0} arızalandı!", i + 1)); break; }
            }
        }

        public float PriceDemandFactor()
        {
            float sum = 0;
            foreach (var f in Fuels)
            {
                float baseMargin = FuelPrice[f] - FuelCost[f];
                sum += (prices[f] - FuelCost[f]) / baseMargin;
            }
            float factor = sum / Fuels.Length;
            return Math.Min(1.3f, Math.Max(0.5f, 1.3f - 0.3f * factor));
        }

        public float EntryChance()
        {
            if (closed) return 0;
            float boost = (promoType == "rush" ? 1.5f : 1f) * PriceDemandFactor();
            float c = boost * (0.32f + 0.1f * signLevel + 0.05f * (reputation - 3))
                + 0.04f * marketLevel + 0.02f * toiletLevel + 0.02f * evChargers
                + (hasWash ? 0.03f : 0) + (hasOil ? 0.03f : 0)
                + (hasCoffee ? 0.02f : 0) + (hasRestaurant ? 0.03f : 0)
                + (hasTruckPark ? 0.02f : 0) + 0.02f * Math.Min(airWaterCount, 3)
                + 0.02f * Math.Min(selfWashCount, 3);
            return Math.Min(0.95f, Math.Max(0.08f, c));
        }

        public int OrderNeed(Fuel f) => (int)Math.Floor(tankCapacity - tanks[f]);
        public int OrderCost(Fuel f)
        {
            float disc = promoType == "cheapFuel" ? 0.5f : 1f;
            return (int)Math.Ceiling(OrderNeed(f) * FuelCost[f] * disc);
        }
        public bool CanOrder(Fuel f)
        {
            var o = orders[f];
            return !o.pending && !o.arrived && !o.delivering && OrderNeed(f) >= 100 && money >= OrderCost(f);
        }
        public bool PlaceOrder(Fuel f)
        {
            if (!CanOrder(f)) return false;
            money -= OrderCost(f);
            orders[f].pending = true;
            orders[f].eta = OrderEta;
            return true;
        }
        public void DeliverFuel(Fuel f) => tanks[f] = tankCapacity;

        public void FacEarn(string id, float amt)
        {
            money += amt;
            facDaily[id] = (facDaily.GetValueOrDefault(id)) + amt;
            facTotal[id] = (facTotal.GetValueOrDefault(id)) + amt;
        }
        public void AddPending(string id, float amt, string name)
        {
            facDaily[id] = facDaily.GetValueOrDefault(id) + amt;
            facTotal[id] = facTotal.GetValueOrDefault(id) + amt;
            const float cap = 600;
            float cur = pendingCash.GetValueOrDefault(id);
            pendingCash[id] = Math.Min(cap, cur + amt);
            if (cur < cap && pendingCash[id] >= cap) events.Add(Loc.T("{0} kumbarası doldu — üstüne tıklayıp topla!", name));
        }
        public int CollectPending(string id)
        {
            int amt = (int)Math.Round(pendingCash.GetValueOrDefault(id));
            if (amt > 0) { money += amt; pendingCash.Remove(id); }
            return amt;
        }

        public void AddRep(float d)
        {
            if (graceActive && d < 0) d *= 0.5f;
            float floor = graceActive ? 2.5f : 0;
            reputation = Math.Max(floor, Math.Min(5, reputation + d));
        }
    }
}
