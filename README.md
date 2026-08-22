# ACB · Kalkulator pošiljk

Spletna aplikacija za razdelitev vrednosti artiklov in poštnine med prejemnike, spremljanje plačil ter pripravo internih povzetkov in računov PDF.

## Lokalni razvoj

```bash
npm install
npm run dev
```

Za prijavo nastavi `VITE_CLERK_PUBLISHABLE_KEY`. Brez ključa se aplikacija zažene v lokalnem razvojnem načinu.

## Shranjevanje

- osnutek se samodejno shranjuje v `localStorage`;
- zgodovina paketov uporablja IndexedDB in zato ni več omejena z velikostjo Clerk metapodatkov;
- stari lokalni paketi in paketi iz Clerk `unsafeMetadata` se ob prvem zagonu samodejno prenesejo;
- JSON varnostna kopija omogoča prenos zgodovine in osnutka med brskalniki ali napravami.

Podatki so ločeni po Clerk uporabniškem računu. Za pravo samodejno sinhronizacijo med napravami je v naslednjem koraku smiseln namenski podatkovni servis (na primer Supabase), ne uporabniški metapodatki ponudnika prijave.
