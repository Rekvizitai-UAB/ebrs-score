# EBRS · v7.0.0

Atviras Lietuvos įmonių reputacijos vertinimo algoritmas, naudojamas [topimones.lt](https://www.topimones.lt/metodologija). Viešasis kodas skelbiamas [Rekvizitai-UAB/ebrs-score](https://github.com/Rekvizitai-UAB/ebrs-score).

**13 signalų, 4 ašys, 0–10 balų skalė.** Paminėjimai internete, jų sentimentas, naudotojų vertinimai, TOP sąrašų istorija ir įsigytas paketas balo nekeičia. Ankstesnė „Rinkos patikimumo“ ašis pašalinta: nevienoda paieškos aprėptis ir viešumas nėra pakankamas pagrindas palyginamam įmonių patikimumo vertinimui.

## Kas pasikeitė 2026-09-25

- Pašalinti `market_presence` ir `community_trust` signalai. Jų ankstesni įėjimo laukai palikti neprivalomi suderinamumui, tačiau skaičiuojant ignoruojami.
- Kitų 13 signalų santykiniai svoriai išlaikyti: kiekvienas ankstesnis svoris dalijamas iš 0,86.
- Aprėptis skaičiuojama iš 13 signalų. Mažiau nei 5 apskaičiuojami signalai reiškia `scoreState: 'insufficient_data'`; vartotojui negalima skelbti patikimumo kategorijos.
- Išsaugotos bankroto ir restruktūrizavimo ribos, įskaitant produkcinės sistemos datuotų RC ir AVNT būsenų bei dokumentuotų pataisymų logiką.
- Viešasis kodas suderintas su produkcinėmis SODROS grynosios pradelstos skolos ir pelno laukų pasirinkimo taisyklėmis.
- Skirtingų versijų balų skirtumas **nėra įmonės veiklos pokytis**. Produkcinė sistema išsaugo ankstesnius balus ir nesiunčia reputacijos pokyčio perspėjimų tarp skirtingų metodikos versijų.

## Svoriai

| Ašis | Svoris | Signalų skaičius |
| --- | ---: | ---: |
| Tęstinumas | 18,60 % | 2 |
| Finansinė drausmė | 27,91 % | 4 |
| Atsparumas | 16,28 % | 2 |
| Skaidrumas | 37,21 % | 5 |

Procentai lentelėse suapvalinti; skaičiavimui naudojami tikslūs svoriai.

| Signalas | Svoris |
| --- | ---: |
| Tęstinumo kapitalas | 9,30 % |
| Teisinis statusas | 9,30 % |
| Finansinis pajėgumas | 9,30 % |
| Augimo trajektorija | 5,81 % |
| Pelningumo tendencija | 5,81 % |
| Mokestinė drausmė | 6,98 % |
| Verslo atsparumas | 8,14 % |
| Darbuotojų gerovė | 8,14 % |
| Duomenų pilnumas | 2,33 % |
| Viešųjų pirkimų patikimumas | 10,47 % |
| Atskaitomybės drausmė | 11,63 % |
| Valdymo kokybė | 6,98 % |
| Nuosavybės skaidrumas | 5,81 % |

## Skaičiavimo tvarka

1. Patikrinami skaitiniai metinių duomenų laukai. Neskaitinės ar neleistinos reikšmės pakeičiamos į `null`.
2. Kiekvienas signalas grąžina rezultatą arba `null`, jei trūksta duomenų. Trūkstamas signalas nelaikomas nuliniu balu.
3. Turimų signalų svoriai perskaičiuojami iki 1; apskaičiuojamas svertinis vidurkis `raw`.
4. Taikoma aprėpties korekcija: `missing = 13 - n`, `priorWeight = 0.5 × missing`, `adjusted = (raw × n + 5 × priorWeight) / (n + priorWeight)`.
5. Registruotas aktyvus bankrotas riboja bendrą balą iki 2,9; aktyvus restruktūrizavimas – iki 4,9. Žr. `src/insolvency.ts` dėl procesų užbaigimo, datų ir RC būsenų suderinimo.
6. Rezultatas apvalinamas iki vienos dešimtosios. Duomenų patikimumo rodiklis: `round(weightedSignalConfidence × n / 13 × 100)`.

`confidence` yra duomenų išsamumo ir aprėpties rodiklis, o ne statistiškai patvirtinta įsipareigojimų įvykdymo tikimybė. Ašių balai rodo jų turimų signalų svertinius vidurkius; bendro balo aprėpties korekcija ir nemokumo riba taikoma atskirai.

## Įėjimo duomenys

Aštuonios duomenų grupės: RC finansinės ataskaitos, SODRA, VMI, RC registracija ir valdymas, RC atskaitomybė, VPT, JADIS, AVNT. Tai grupės, ne aštuonios skirtingos institucijos. Paketas duomenų nerenka ir jų šviežumo nepatvirtina: už pateiktų duomenų kilmę, datas ir teisingumą atsako integruotojas.

SODROS `currentSodraDebt.amount` turi būti **grynoji pradelsta** skola (`max(0, total - deferred)`) su šaltinio data. `null` reiškia nežinomą reikšmę. Jei ši nauja struktūra nepateikta, suderinamumui naudojama metinė eilutė. Neperduokite bendros skolos kaip pradelstos. Pelno signalai naudoja pateiktą grynąjį pelną; jei jo nėra, leidžiamas aiškiai pažymėtas bendrojo pelno pakaitalas.

Finansinės istorijos pilnumo ir tęstinumo normavimo langas yra 10 metų, nepriklausomai nuo TOP sezono. Algoritmas naudoja vykdymo datą amžiui, naujumui ir procesų būsenoms nustatyti; pakartojamiems istoriniams skaičiavimams būtina ta pati atskaitos data.

## Naudojimas iš šaltinio

```sh
git clone https://github.com/Rekvizitai-UAB/ebrs-score.git
cd ebrs-score
npm ci
npm test
npm run build
```

```ts
import { computeReputation } from './dist/index.js'

const result = computeReputation({
  companyId: 1,
  companyName: 'Pavyzdinė UAB',
  foundedYear: 2010,
  yearlyRows: [
    { year: 2024, revenue: 1_000_000, profit: 100_000, netProfit: 80_000, employees: 20, salary: 2000, sodraDebt: null },
    { year: 2025, revenue: 1_100_000, profit: 120_000, netProfit: 90_000, employees: 21, salary: 2100, sodraDebt: null },
  ],
  currentSodraDebt: { amount: null, date: null },
  procurementData: null, taxData: null, legalData: null,
  reportingData: null, governanceData: null, ownershipData: null,
  bankruptcyData: null,
})

if (result && result.scoreState === 'ok') {
  console.log(result.overall, result.algorithmVersion)
}
```

## Ribos ir patikra

EBRS yra platformos metodika, ne valstybės suteiktas reitingas, kredito garantija ar nepriklausomai sertifikuotas standartas. Svoriai ir ribos yra modelio sprendimai. Algoritmas savaime neįrodo, kad šaltinis tikslus, išsamus ar šiandien atnaujintas. Pašalinus viešumo signalus šios likusių šaltinių ribos neišnyksta.

Testai apima svorių sumą, trūkstamus duomenis, nemokumo procesų būsenas, pradelstos skolos pasirinkimą ir rezultato nekintamumą keičiant paminėjimus, atsiliepimus ar narystę. Produkciniame diegime papildomai tikrinama viso registro rezultatų atitiktis.

## Failai

- `src/scorer.ts`: grynasis skaičiavimo variklis.
- `src/signals.ts`: 13 signalų formulės ir svoriai.
- `src/insolvency.ts`, `src/legal-status.ts`: teisinės būsenos ir balo ribų taikymas.
- `src/reported-profit.ts`: pateiktų pelno duomenų pasirinkimas.
- `src/types.ts`: įėjimo ir rezultatų tipai.

## License

MIT. See [LICENSE](LICENSE). Earlier revisions remain in Git history.
