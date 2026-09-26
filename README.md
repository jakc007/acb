# ACB · Kalkulator pošiljk

Razdelitev artiklov, poštnine in plačil po osebah, dejanski profit ter PDF računi.

## Razvoj in preverjanje

```sh
npm ci
npm test
npm run dev
npm run build
```

Kopiraj `.env.example` v `.env.local` in vnesi javne nastavitve. Brez Clerk ključa aplikacija deluje lokalno. Brez nastavljenega Supabase aplikacija jasno prikaže, da podatki ostajajo samo na tej napravi.

## Brezplačen oblak: enkratna nastavitev

Uporablja se **Supabase Free**, obstoječa prijava pa ostane **Clerk**. Nov plačljiv paket ni potreben. Free ima omejitve (trenutno 500 MB baze, 50.000 zunanjih mesečno aktivnih uporabnikov); neaktivni projekti se lahko začasno ustavijo. Aktualne omejitve: https://supabase.com/pricing. Izberi Free, ne Pro.

1. Na https://supabase.com/dashboard ustvari brezplačen projekt, po možnosti v evropski regiji. Geslo baze shrani zase; aplikacija ga ne potrebuje.
2. V **SQL Editor** prilepi in enkrat zaženi celotno datoteko [`supabase/migrations/202609260001_workspace.sql`](supabase/migrations/202609260001_workspace.sql). Ustvari tabelo, pravila zasebnosti in funkcijo za varno shranjevanje.
3. V Clerk nadzorni plošči odpri **Connect with Supabase** in aktiviraj povezavo za isto Clerk instanco, kot jo uporablja ACB. S tem sejni žetoni dobijo `role: authenticated`.
4. V Supabase odpri **Authentication → Third-Party Auth → Add integration → Clerk** in dodaj domeno svoje Clerk instance. Uporabi novo Third-Party Auth povezavo, ne zastarele JWT predloge z deljenim podpisnim ključem. Navodila: https://supabase.com/docs/guides/auth/third-party/clerk.
5. Iz Supabase dialoga **Connect** oziroma nastavitev projekta prekopiraj **Project URL** in **Publishable key**. Starejši javni `anon` ključ je prav tako podprt. Na gostovanju ACB nastavi:

   ```text
   VITE_CLERK_PUBLISHABLE_KEY=<obstoječi Clerk publishable ključ>
   VITE_SUPABASE_URL=https://<projekt>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<javni ključ>
   ```

   To so javne nastavitve za brskalnik. **Ne vstavljaj `service_role`, `sb_secret_…`, Clerk secret ključa ali gesla baze.** Dostop do podatkov omejujejo prijava in SQL pravila po uporabniku.
6. Ponovno zgradi/objavi aplikacijo; Vite vključi te nastavitve med gradnjo. V Clerk se odjavi in ponovno prijavi, da dobiš nov sejni žeton.
7. Najprej odpri ACB na napravi z obstoječimi pošiljkami. Počakaj na **Shranjeno v oblaku**. Nato se na drugi napravi prijavi z istim računom in preveri osnutek ter zgodovino.

Če vidiš napako 401/403, preveri Clerk povezavo na obeh straneh in novo prijavo. Napaka 404 navadno pomeni, da SQL še ni zagnan. Zaustavljen Free projekt nadaljuj iz Supabase nadzorne plošče.

## Kaj se sinhronizira

- Osnutek, osebe, tečaji, prejeti zneski, nastavitve obračuna in PDF ter ime/identiteta odprtega paketa se samodejno shranijo po približno 0,7 sekunde mirovanja.
- Gumb **Shrani paket** ustvari poimenovan zapis v zgodovini. Nadaljnje spremembe odprtega shranjenega paketa se samodejno posodabljajo.
- Zgodovina, uvoz in brisanje so del iste zasebne oblačne shrambe. Druge odprte naprave preverijo spremembe vsakih 15 sekund in ob vrnitvi v zavihek oziroma obnovi povezave.
- Prva povezava prenese lokalno zgodovino in stare Clerk metapodatke. Če v oblaku že obstaja drugačen paket z istim ID, se lokalni ohrani kot kopija. Drugačen neprazen lokalni osnutek se ohrani kot paket »Uvožen osnutek s te naprave«.
- Lokalna kopija ostane za obnovo. Ob prekinitvi povezave po začetnem nalaganju se spremembe shranijo lokalno in čakajo na ponovni poskus. Po ponovnem odprtju aplikacija najprej preveri oblak; do uspešne povezave je urejanje onemogočeno.
- Pri sočasnem urejanju obeh naprav strežnik zavrne zastarelo revizijo. Aplikacija ohrani tvojo različico in pokaže konflikt. Izvozi svojo JSON kopijo, naloži oblačno različico, nato po potrebi obnovi spremembe. Ni tihega prepisovanja.

Podatki so trenutno shranjeni v enem dokumentu na račun (osnutek in zgodovina skupaj). To ustreza osebni uporabi; za zelo veliko zgodovino bi bila smiselna ločena tabela paketov. Konflikt se zazna tudi pri sočasni spremembi različnih paketov. JSON izvoz je še vedno na voljo kot neodvisna varnostna kopija.

## Profit

Nabava = vrednost artiklov in pripadajoče poštnine po originalnem nabavnem tečaju. **Dejanski profit = prejeto − nabava**, načrtovani profit = končna prodajna cena − nabava. Nabava 180 €, prodajna cena 200 €, prejeto 220 € pomeni **40 € profita** in 20 € preplačila. Skupen profit paketa odšteje celotno nabavo in poštnino, tudi pri nedodeljenih artiklih ali manjkajoči teži. Do plačila je lahko negativen.

## Preverjanje oblaka po nastavitvi

1. Na napravi A spremeni artikel in znesek »Prejeto«; preveri »Shranjeno v oblaku« in iste vrednosti na B.
2. Shrani paket, popravi njegovo ime, osveži B in preveri posodobitev. Izbriši testni paket in preveri odstranitev na B.
3. Na A po začetnem nalaganju izklopi internet, nekaj spremeni in ga spet vklopi. Preveri naknadno shranjevanje.
4. Na A in B spremeni podatke pred sinhronizacijo. Druga naprava mora ponuditi izvoz svoje različice in nalaganje oblaka.
5. Z drugim Clerk računom preveri prazno, ločeno shrambo.

Testi `npm test` pokrivajo izračune, migracijo, lokalno shrambo, izgubljene odgovore, izpade omrežja in konflikte dveh naprav. SQL preverjanje pravil je v `supabase/tests/workspace.sql`; zaženi ga v SQL Editor po migraciji. Test teče v transakciji in na koncu razveljavi testne podatke.
