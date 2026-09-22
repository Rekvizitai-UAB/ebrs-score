# EBRS — Europos verslo reputacijos standartas
### European Business Reputation Standard

> **Versija 6.0.0 · Viešoji peržiūra (Public Review)**
>
> Atviras verslo reputacijos vertinimo protokolas — kandidatas į standartą, viešosios peržiūros stadijoje.
> Metodologija publikuojama viešai skaidrumo, bendruomenės peržiūros ir nepriklausomos
> verifikacijos tikslais. EBRS NĖRA Europos standartizacijos organizacijų (CEN, CENELEC,
> ETSI) priimtas standartas ir tokiu netaps be nepriklausomos verifikacijos. Algoritmas
> dar nėra nepriklausomai audituotas — naudokite produkcinėje aplinkoje savo atsakomybe.

---

## Paskirtis

EBRS — tai standartizuota verslo reputacijos vertinimo sistema, sukurta dirbti su viešai prieinamais Europos verslo registrų duomenimis. Algoritmas skaičiuoja 0–10 balų reputacijos vertinimą pagal 15 signalų, sugrupuotų į 5 ašis.

Tikslas — sukurti atvirą, skaidrų ir nepriklausomą verslo patikimumo vertinimo protokolą, kurį galėtų naudoti:
- Valstybinės institucijos ir viešieji pirkimai
- Finansų sektorius (bankų rizikos vertinimas, kreditavimas)
- Verslo partnerystės ir tiekimo grandinės
- Akademiniai tyrimai ir verslo analitika
- Programinės įrangos kūrėjai (integracija į savo sistemas)

## Statusas

| | |
|---|---|
| **Stadija** | Viešoji peržiūra — metodika paskelbta, taikoma produkcijoje, atvira nepriklausomai peržiūrai |
| **Versija** | 6.0.0 |
| **Licencija** | MIT (laisvai naudoti, modifikuoti, platinti) |
| **Priklausomybės** | 0 (tik TypeScript) |
| **Testai** | 15 automatinių testų (įsk. v6.0 garantijų testus) |
| **Verifikacija** | Dar nebuvo nepriklausomai audituotas |
| **Fondas** | Planuojamas (nepriklausoma verifikacijos ir valdymo institucija) |

**Svarbu**: šis algoritmas yra ankstyvos stadijos eksperimentinis projektas. Jis nėra oficialus standartas, kol nebus nepriklausomai verifikuotas. Naudojimas produkcinėje aplinkoje — naudotojo atsakomybė. Kviečiame prisidėti prie peržiūros ir tobulinimo.

---

## Naudojimas

```bash
git clone https://github.com/Rekvizitai-UAB/ebrs-score.git
cd ebrs-score
npm install
npm run build
```

### Pavyzdys

```typescript
import { computeReputation } from './dist/index.js'

const rezultatas = computeReputation({
  companyId: 1,
  companyName: 'Pavyzdys UAB',
  yearlyRows: [
    { year: 2022, revenue: 3200000, profit: 280000, netProfit: 240000, employees: 35, salary: 1500, sodraDebt: 0 },
    { year: 2023, revenue: 5000000, profit: 400000, netProfit: 350000, employees: 45, salary: 1800, sodraDebt: 0 },
    { year: 2024, revenue: 6200000, profit: 550000, netProfit: 480000, employees: 52, salary: 2100, sodraDebt: 0 },
  ],
  mentions: [],
  ratingAverage: null,
  ratingCount: 0,
  topYearsListed: 0,
  foundedYear: 2015,
  activationStatus: 'inactive',
  procurementData: null,
  taxData: null,
  legalData: null,
  reportingData: null,
  governanceData: null,
  ownershipData: null,
})

if (rezultatas) {
  console.log(`Balas: ${rezultatas.overall}/10`)
  console.log(`Patikimumas: ${rezultatas.confidence}%`)
  console.log(`Rizikos lygis: ${rezultatas.riskLevel}`)
  for (const asis of rezultatas.ebrsAxes) {
    console.log(`  ${asis.name}: ${asis.score}/10`)
  }
}
```

---

## Metodologija

### Naujovės v6.0 (terminalinės būsenos ir sąžiningi svoriai)

v6.0 — išorinio kritinio audito (2026-07) išvadų įgyvendinimas:

1. **Terminalinės būsenos riba.** Adityvi kompozicija leido 14 sveikų signalų
   „perbalsuoti" vieną katastrofišką būseną: bankrutuojanti įmonė su gera
   finansine istorija gaudavo ~6,3 balo. v6.0 registruotą nemokumą traktuoja
   kaip RIBĄ, ne kaip balsą: aktyvus bankrotas (įsk. tyčinį) riboja balą iki
   **2,9**, restruktūrizavimas — iki **4,9**. Riba taikoma po aprėpties
   korekcijos ir visada deklaruojama per `capApplied` — niekada tyliai.

2. **Svoriai sumuojasi tiksliai į 100 %.** v5.x publikuoti svoriai sumavosi į
   96 % ir rėmėsi tyliu pernormavimu. Trūkstami 4 p.p. paskirstyti nemokumui
   jautriems drausmės signalams: legal_standing 7→8 %, tax_discipline 5→6 %,
   growth 4→5 %, profitability 4→5 %. Ašys: Tęstinumas 16 / Finansinė drausmė 24 /
   Rinkos patikimumas 14 / Atsparumas 14 / Skaidrumas 32 = 100.

3. **Nuosavybės signalas perrašytas.** Vertinamas JADIS deklaracijos
   išsamumas ir galutinių naudos gavėjų atsekamumas; savininkų PILIETYBĖ ar
   jurisdikcija balo nebekeičia (v5.x bausdavo užsienio juridinius asmenis
   per se — analitiškai ir politiškai nepagrįsta ES kontekste).

4. **Verdikto slenkstis.** Žemiau 5 iš 15 apskaičiuojamų signalų verdikto
   juosta nerodoma (`scoreState: 'insufficient_data'`) — skaičius be verdikto.

5. **Įvesties apsauga pačiame `computeReputation`.** v5.3 apsaugos (NaN /
   begalybė / neįmanomi metai) veikė tik produkcinėje duomenų surinkimo
   grandinėje; v6.0 jas perkelia į viešą įėjimo tašką (`sanitizeCompanyData`),
   todėl tiesioginiai kvietimai apsaugoti taip pat.

### Naujovės v5.3 (aprėpties korekcija)

v5.3 ištaiso **išlikimo (survivorship) šališkumą** - didžiausią ankstesnių versijų
trūkumą. Kai įmonė turi mažai apskaičiuojamų signalų, svoriai pernormuojami tik
tarp esamų signalų. Jei trūkstantys signalai yra būtent nepalankieji (mokestinė
skola, ataskaitų neteikimas, bankrotas, nuosavybės neskaidrumas), neapibrėžtos
įmonės balas dirbtinai išpučiamas - vien dėl to, kad jos niekas pilnai
nepatikrino. Duomenų požiūriu neturtinga įmonė galėjo aplenkti pilnai ištirtą.

**Sprendimas - aprėpties korekcija (coverage shrinkage):** galutinis `overall`
balas regresuojamas link neutralaus prioro (5.0) proporcingai tam, kiek signalų
**trūksta**. Kiekvienas trūkstamas signalas veikia kaip pusės svorio neutralus
pseudo-stebėjimas:

```
overall_adjusted = (overall_raw · n_active + 5.0 · 0.5 · n_missing)
                   / (n_active + 0.5 · n_missing)
```

- **Pilna aprėptis** (visi signalai): korekcijos nėra, balas nekinta.
- **Reta aprėptis**: stiprus traukimas link neutralaus 5.0.
- Atskirų **signalų ir ašių** balai lieka neapdoroti (jie atspindi išmatuotas
  dimensijas); reguliuojamas tik bendras `overall`.

Pavyzdys: įmonė su 3 puikiais finansiniais signalais (balas 8,0), bet be 12
valstybinių/rinkos signalų: `(8·3 + 5·6)/(3+6) = 6,0`. Pilnai ištirta įmonė su
8,0 balu lieka 8,0.

Be to, v5.3 prideda **įvesties apsaugą** - neįmanomų metų eilutės (pvz. 3905) ir
NaN / begalybės / neigiamos finansinės reikšmės pašalinamos prieš patekdamos į
signalus.

### 5 vertinimo ašys

| Ašis | Svoris | Signalų skaičius | Vertinimo objektas |
|------|--------|-----------------|-------------------|
| **Tęstinumas** | 16% | 2 | Veiklos trukmė, teisinis statusas, duomenų istorija |
| **Finansinė drausmė** | 24% | 4 | Pajamos, pelningumas, augimo nuoseklumas, mokestinė drausmė |
| **Rinkos patikimumas** | 14% | 2 | Viešumo lygis, bendruomenės vertinimai |
| **Atsparumas** | 14% | 2 | Pajamų stabilumas, darbuotojų gerovė, atlyginimų dinamika |
| **Skaidrumas** | 32% | 5 | Ataskaitų drausmė, valdymo struktūra, nuosavybės aiškumas, viešieji pirkimai |

### 15 signalų registras

| # | Signalas | Ašis | Svoris | Minimalūs duomenys |
|---|---------|------|--------|-------------------|
| 1 | Finansinis pajėgumas | Finansinė drausmė | 8% | 1 metų pajamos |
| 2 | Augimo trajektorija | Finansinė drausmė | 5% | 2 metų pajamos |
| 3 | Pelningumo tendencija | Finansinė drausmė | 5% | 1 metų pelnas |
| 4 | Mokestinė drausmė | Finansinė drausmė | 6% | Mokesčių inspekcijos įrašas |
| 5 | Tęstinumo kapitalas | Tęstinumas | 8% | Įkūrimo metai arba 1 m. duomenys |
| 6 | Teisinis statusas | Tęstinumas | 8% | Juridinių asmenų registro įrašas |
| 7 | Viešumas | Rinkos patikimumas | 7% | 1+ paminėjimas viešojoje erdvėje |
| 8 | Bendruomenės pasitikėjimas | Rinkos patikimumas | 7% | 1+ vertinimas |
| 9 | Verslo atsparumas | Atsparumas | 7% | 3 metų pajamos |
| 10 | Darbuotojų gerovė | Atsparumas | 7% | 1 m. atlyginimo arba darbuotojų duomenys |
| 11 | Duomenų pilnumas | Skaidrumas | 2% | 1 metų duomenys |
| 12 | Viešųjų pirkimų patikimumas | Skaidrumas | 9% | 1+ dalyvavimas viešuosiuose pirkimuose |
| 13 | Atskaitomybės drausmė | Skaidrumas | 10% | Finansinių ataskaitų pateikimo įrašas |
| 14 | Valdymo kokybė | Skaidrumas | 6% | Valdymo organų registracijos įrašas |
| 15 | Nuosavybės skaidrumas | Skaidrumas | 5% | Akcininkų registro įrašas |

### Skaičiavimo principai

**1. Null-išskyrimo principas.** Signalai, kuriems trūksta duomenų, grąžina `null` ir yra visiškai pašalinami iš vertinimo. Svoriai automatiškai perskaičiuojami tarp aktyvių signalų. Jokių dirbtinių numatytųjų reikšmių.

**2. Patikimumo balas.** Skaičiuojamas pagal formulę: `patikimumas = svertinis vidutinis signalų patikimumas × signalų padengimas`. Įmonė su 5 iš 15 signalų niekada neviršys 33% patikimumo, nepriklausomai nuo tų signalų kokybės.

**3. Krypties matavimas.** Augimo nuoseklumas vertinamas pagal metų su teigiamu augimu dalį, o ne pagal variacijos koeficientą. Tai užtikrina, kad sparčiai augančios įmonės nebūtų baudžiamos dėl kintančio augimo tempo.

**4. Valstybinių duomenų prioritetas.** Skaidrumo ašis (32%) turi didžiausią svorį ir yra skirta dirbti su oficialiais valstybinių registrų duomenimis — mokesčių inspekcija, juridinių asmenų registras, akcininkų registras, viešieji pirkimai.

**5. Platformos neutralumas.** Vertinimai nepriklauso nuo narystės ar prenumeratos jokioje platformoje. Duomenų pilnumo signalas turi tik 2% svorį.

### Duomenų šaltiniai

Algoritmas priima duomenis iš bet kurio šaltinio. Sąsajos suprojektuotos pagal tipinius Europos verslo registrų duomenis:

| Sąsaja | Tipinis šaltinis | Būtinas? |
|--------|-----------------|----------|
| `yearlyRows` | Finansinės ataskaitos (pajamos, pelnas, darbuotojai, atlyginimai) | Taip (bent 1 metai) |
| `mentions` | Viešosios erdvės stebėsena (SERP, naujienų portalai) | Ne |
| `taxData` | Mokesčių inspekcija | Ne |
| `legalData` | Juridinių asmenų registras | Ne |
| `reportingData` | Ataskaitų nepateikusiųjų sąrašai | Ne |
| `governanceData` | Valdymo organų registras | Ne |
| `ownershipData` | Akcininkų / dalyvių registras | Ne |
| `procurementData` | Viešųjų pirkimų duomenys | Ne |

---

## Prisidėjimas ir verifikacija

EBRS yra atviras protokolas. Algoritmo kodas — viešas ir skaidrus. Kiekvieno signalo matematinė formulė matoma `src/signals.ts` faile.

### Kaip prisidėti

- **Matematinė peržiūra** — audituokite signalų formules, nustatykite šališkumą ar klaidas
- **Signalų patobulinimai** — pasiūlykite geresnius matematinius modelius
- **Nauji signalai** — papildomi duomenų šaltiniai (ESG, kredito reitingai, teismo bylos)
- **Šalių adaptacijos** — duomenų šaltinių susiejimai kitų Europos šalių registrams
- **Nepriklausoma verifikacija** — akademinė ar institucinė metodologijos peržiūra
- **Kalbos** — signalų pavadinimai ir paaiškinimai papildomomis kalbomis

### Verifikacijos statusas

Šis algoritmas **dar nebuvo nepriklausomai verifikuotas**. Jis publikuojamas kaip eksperimentinis projektas su tikslu:

1. Suteikti galimybę bendruomenei peržiūrėti ir kritikuoti metodologiją
2. Skatinti diskusiją apie standartizuotą verslo reputacijos vertinimą Europoje
3. Surinkti atsiliepimus iš ekonomistų, duomenų mokslininkų ir reguliavimo ekspertų
4. Paruošti pagrindą nepriklausomai verifikacijai per būsimą fondą

Jei esate ekonomistas, statistikas, duomenų mokslininkas ar reguliavimo ekspertas ir norite prisidėti prie peržiūros — susisiekite per [GitHub Issues](https://github.com/Rekvizitai-UAB/ebrs-score/issues).

### Planuojamas fondas

Planuojama įsteigti nepriklausomą fondą EBRS standarto verifikavimui ir priežiūrai. Fondo tikslai:

- Nepriklausomas metodologijos auditas
- Svorių ir signalų peržiūra ekonomistų ekspertų grupės
- Versijų valdymas ir atgalinio suderinamumo politika
- Šalių adaptacijų koordinavimas
- Sertifikavimo programa įdiegusiems EBRS organizacijoms

---

## Programinė sąsaja (API)

### `computeReputation(data: CompanyData): ReputationScore | null`

Pagrindinė vertinimo funkcija. Grąžina `null`, jei nė vienas signalas neturi pakankamai duomenų.

### `SIGNAL_REGISTRY: SignalDefinition[]`

15 signalų registras. Kiekvienas turi `compute(data) => SignalResult | null`.

### `EBRS_AXES: Record<EbrsAxis, { name, description }>`

5 ašių metaduomenys.

---

## Licencija

**MIT** — laisvai naudoti, modifikuoti ir platinti bet kokiam tikslui, įskaitant komercinį.

Ši licencija nereiškia, kad algoritmas yra verifikuotas ar sertifikuotas. Naudojimas produkcinėje aplinkoje — naudotojo atsakomybė.

---

# English Documentation

## EBRS — European Business Reputation Standard

> **Version 6.0.0 · Public Review** — Open protocol for standardized business reputation scoring, published for transparency and independent review. Applied in production; not yet independently audited — a candidate standard, not an adopted one.

### Usage

```bash
git clone https://github.com/Rekvizitai-UAB/ebrs-score.git
cd ebrs-score && npm install && npm run build
```

### Example

```typescript
import { computeReputation } from './dist/index.js'

const score = computeReputation({
  companyId: 1,
  companyName: 'Example Ltd',
  yearlyRows: [
    { year: 2023, revenue: 5000000, profit: 400000, netProfit: 350000, employees: 45, salary: 1800, sodraDebt: 0 },
    { year: 2024, revenue: 6200000, profit: 550000, netProfit: 480000, employees: 52, salary: 2100, sodraDebt: 0 },
  ],
  mentions: [], ratingAverage: null, ratingCount: 0, topYearsListed: 0,
  foundedYear: 2015, activationStatus: 'inactive',
  procurementData: null, taxData: null, legalData: null,
  reportingData: null, governanceData: null, ownershipData: null,
})

if (score) {
  console.log(`${score.overall}/10 (${score.confidence}% confidence, risk: ${score.riskLevel})`)
}
```

### 5 Axes

| Axis | Weight | What it measures |
|------|--------|-----------------|
| Continuity | 16% | Business longevity, legal standing |
| Financial | 24% | Revenue, margins, growth, tax compliance |
| Market | 14% | Public presence, community trust |
| Resilience | 14% | Revenue stability, workforce health |
| Transparency | 32% | Filing compliance, governance, ownership, procurement |

### Design Principles

1. **Null-exclusion** — signals without data are excluded, not defaulted
2. **Confidence scoring** — reflects actual data coverage
3. **Direction over volatility** — rewards consistent growth direction
4. **Government data priority** — Transparency axis (32%) is heaviest
5. **No platform bias** — scores independent of any subscription

### Contributing

See the Lithuanian section above for full contribution guidelines. In short: mathematical reviews, new signals, country adaptations, and independent verification are all welcome.

### License

MIT — free for any purpose, including commercial use.

This license does not imply the algorithm is verified or certified. Use in production at your own risk.
