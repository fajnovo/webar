# STAV PROJEKTU – WEBAR (Farma Fajnovô, Pozitívne rozprávky)

Posledná aktualizácia: 12. 11. 2026

## Rozhodnutia
- Technológia: Three.js + 8th Wall (open-source/distribuovaný engine, bezplatný), AR cez prehliadač bez inštalácie.
- 8th Wall ako platená platforma skončila 28. 2. 2026. Engine je zadarmo (komerčne aj nekomerčne) ako nezmenený binárny súbor s povinnou atribúciou Niantic Spatial.
- WebXR samotný nestačí (iPhone Safari ho nepodporuje). MindAR sleduje len obrázok/tvár, nie stôl.
- Záložná cesta, ak 8th Wall na iPhone zlyhá: knižnica AlvaAR.

## Hotové
- Overená dostupnosť a licenčné podmienky enginu podľa FAQ na 8thwall.org (text samotnej licencie v balíku ešte neprečítaný).
- Napísaný test „kocka 20 cm s tieňom na stole": `index.html`, `js/test-scene.js`, `js/ar-mode.js`, `js/fallback-mode.js`, `qr.html`, `NOTICE.md`.
- Kontrola syntaxe kódu a simulovaný beh logiky (falošné Three.js a engine): prešli.

## Čo je iba simulované / neoverené
- Skutočné AR na mobile (iPhone aj Android) NIE JE otestované.
- Nie je overené, že engine funguje s Three.js r160 (verziu možno meniť v odkaze: `?three=0.147.0`).
- `XR8.XrDevice.isDeviceBrowserCompatible` a `onCameraStatusChange` nie sú overené v dokumentácii.

## Čaká na rozhodnutie / akciu
- GitHub konektor v tejto relácii nevie vytvoriť nový repozitár. Treba ho vytvoriť ručne (prázdny `webar`), potom ho pripojím a nahrám kód.
- Hosting s HTTPS: GitHub Pages zadarmo vyžaduje verejný repozitár. Verejnosť = potrebný súhlas.

## Najbližší krok
1. Vytvoriť repozitár, nahrať kód, sprístupniť test (po súhlase).
2. Test na iPhone a Androide: stabilita, perspektíva, tiene, obchádzanie stola.
3. Až po úspešnom teste: Billy (ovečka) a Červená čiapočka.
