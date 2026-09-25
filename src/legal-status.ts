/** Official RC JAR status classifier, verified 2026-09-08.
 * https://get.data.gov.lt/datasets/gov/rc/jar/formos_statusai/Statusas
 * Unknown UUIDs remain unknown; never infer a legal state from correlations.
 */
export const RC_LEGAL_STATUS: Readonly<Record<string, string>> = {
  "5ef6b364-a5ff-47fb-8600-ff859214ef85": "Teisinis statusas neįregistruotas",
  "28797208-2fa6-47d3-80e4-e4e8842b44c5": "Reorganizuojamas",
  "0f40689e-10a1-4ded-9919-2d725924e27b": "Dalyvaujantis reorganizavime",
  "a85a856b-1721-411f-9eba-0c56daab7256": "Pertvarkomas",
  "04aca49f-d1f9-47f8-af8a-5800eae51e6b": "Restruktūrizuojamas",
  "20a01d01-4e39-4d14-82f3-a9af198de63b": "Bankrutuojantis",
  "57e62cce-e84c-4b3d-a1af-8d84b1b8e3f2": "Bankrutavęs",
  "adb14ebc-d6c5-4534-8dd9-b3d14e92b19f": "Likviduojamas",
  "1cf22325-901f-4367-b5c9-08d800caa016": "Dalyvaujantis atskyrime",
  "ff75611d-3e1b-491b-8c85-f2ba085815fe": "Inicijuojamas likvidavimas",
  "5bcfd61f-7810-4946-9bd3-6de946b56f18": "Išregistruotas",
  "4da4894c-62f8-4cf3-b97c-3746b20a1b60": "Likviduotas",
  "eede2b09-4023-4298-a4a6-f6eb42308447": "Nepersiregistravęs",
  "dcc44db5-92ba-4523-bdce-0d9d42f1cfe3": "Bankrutuojantis",
  "7ddd12c6-624c-44fd-b16c-5f35318121b8": "Inicijuojantis Europos bendrovės steigimą jungimosi būdu",
  "c534e36a-f53c-4407-bc60-ad70e25066a3": "Inicijuojantis Europos bendrovės steigimą valdymo (holdingo) būdu",
  "335420e8-17e5-42e9-8609-149a9aa6e04d": "Europos bendrovė, kurios buveinė yra perkeliama",
  "9881b8a7-8922-4816-b414-e507dc92b695": "Inicijuojantis Europos kooperatinės bendrovės steigimą jungimosi būdu",
  "cdaa9a4f-4ee1-401a-9de0-644d47af971f": "Europos kooperatinė bendrovė, kurios buveinė perkeliama",
  "e79febc5-f528-4a69-9142-272d88347eb6": "Jungiama, peržengiant vienos valstybės ribas, akcinė bendrovė ar uždaroji akcinė bendrovė",
  "77ef42a0-6993-4e9c-832d-f335594f6ab4": "Dalyvaujanti vienos valstybės ribas peržengiančiame jungimesi AB ar UAB",
  "74381b18-7ae6-4c1d-a34b-5d8603851476": "Jungiamas peržengiant vienos valstybės ribas juridinis asmuo",
  "9b5c14c0-0138-44f3-8346-ca466b450374": "Dalyvaujantis jungimesi peržengiant vienos valstybės ribas juridinis asmuo",
  "1768840c-d439-4b33-98aa-64f8d2c7acc5": "Perkeliantis buveinę",
  "d9230d9e-b6a3-440b-aa1b-5b48f1656340": "Likviduojamas dėl bankroto",
  "06c9b6a9-8841-44a1-a04f-82766bb8d61a": "Jungiama peržengiant vienos valstybės ribas bendrovė",
  "e7b2ecf4-54ec-46ff-96ae-933ed1f13415": "Dalyvaujanti vienos valstybės ribas peržengiančiame jungimesi bendrovė",
  "6a85efc5-406f-4b8f-9ee8-6ecd7f63afb9": "Pertvarkoma peržengiant vienos valstybės ribas bendrovė",
  "93783c7f-d7f7-4154-bd90-43015af9e6ac": "Skaidoma peržengiant vienos valstybės ribas bendrovė",
  "0561e9cc-9df8-44ae-8bef-3d49f0fa1a71": "Inicijuojantis kontroliuojančiosios Europos bendrovės steigimą",
  "b0a9bfb0-e1a3-4964-9a83-4641e27b08a8": "Perkeliantis buveinę į kitą valstybę"
}

export function registeredLegalStatus(legacy: string | null | undefined, rcStatus?: string | null, deregistered?: Date | string | null): string | null {
  if (deregistered) return 'Išregistruotas'
  return (rcStatus ? RC_LEGAL_STATUS[rcStatus] : null) ?? legacy ?? null
}
