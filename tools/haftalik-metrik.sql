-- BenelOil haftalık metrikler (SALT OKUMA — hiçbir kayda dokunmaz)
\pset format unaligned
\pset fieldsep '|'
SELECT 'toplam_oyuncu',        count(*)::text FROM benzinlik_player
UNION ALL SELECT 'kayit_7g',   count(*)::text FROM benzinlik_player WHERE created_at > now()-interval '7 days'
UNION ALL SELECT 'aktif_7g',   count(*)::text FROM benzinlik_player WHERE last_seen_at > now()-interval '7 days'
UNION ALL SELECT 'aktif_24s',  count(*)::text FROM benzinlik_player WHERE last_seen_at > now()-interval '24 hours'
UNION ALL SELECT 'oturum_top', COALESCE(sum(sessions),0)::text FROM benzinlik_player
UNION ALL SELECT 'ziyaret_7g', COALESCE(sum(visits),0)::text FROM benzinlik_stat_hourly WHERE hour > now()-interval '7 days'
UNION ALL SELECT 'misafir_7g', COALESCE(sum(guests),0)::text FROM benzinlik_stat_hourly WHERE hour > now()-interval '7 days'
UNION ALL SELECT 'misafir_kayit_7g', COALESCE(sum(guest_signups),0)::text FROM benzinlik_stat_hourly WHERE hour > now()-interval '7 days'
UNION ALL SELECT 'signup_7g', COALESCE(sum(signups),0)::text FROM benzinlik_stat_hourly WHERE hour > now()-interval '7 days'
UNION ALL SELECT 'feedback_7g', count(*)::text FROM benzinlik_feedback WHERE created_at > now()-interval '7 days'
-- oyun içi toplamlar (save JSON'undan): servis edilen müşteri, toplam ciro, en yüksek gün
UNION ALL SELECT 'servis_edilen_musteri', COALESCE(sum((save->'s'->'stats'->>'served')::bigint),0)::text FROM benzinlik_player WHERE save IS NOT NULL
UNION ALL SELECT 'toplam_ciro',  COALESCE(round(sum((save->'s'->'stats'->>'revenue')::numeric)),0)::text FROM benzinlik_player WHERE save IS NOT NULL
UNION ALL SELECT 'toplam_litre', COALESCE(round(sum(
     COALESCE((save->'s'->'stats'->'liters'->>'benzin')::numeric,0)
   + COALESCE((save->'s'->'stats'->'liters'->>'dizel')::numeric,0)
   + COALESCE((save->'s'->'stats'->'liters'->>'lpg')::numeric,0))),0)::text FROM benzinlik_player WHERE save IS NOT NULL
UNION ALL SELECT 'en_yuksek_gun', COALESCE(max((save->'s'->>'day')::int),0)::text FROM benzinlik_player WHERE save IS NOT NULL
UNION ALL SELECT 'ortalama_gun',  COALESCE(round(avg((save->'s'->>'day')::int),1),0)::text FROM benzinlik_player WHERE save IS NOT NULL
UNION ALL SELECT 'toplam_pompa',  COALESCE(sum((save->'s'->>'pumps')::int),0)::text FROM benzinlik_player WHERE save IS NOT NULL
UNION ALL SELECT 'gun100_ustu',   count(*)::text FROM benzinlik_player WHERE (save->'s'->>'day')::int > 100;
