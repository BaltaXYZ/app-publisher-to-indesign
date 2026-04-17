# Instruktionsdokument för Codex: Publisher till InDesign-webapp

## 1. Appens namn eller arbetsnamn
**Pub2InDesign**

## 2. Appens kärnsyfte i en mening
Appen ska låta användaren ladda upp en Microsoft Publisher-fil och få tillbaka en InDesign-kompatibel fil med så exakt visuell och strukturell återgivning som möjligt, där layout, typografi, färger, kolumner, objektplacering och dokumentformat återskapas samt definieras som redigerbara format i måldokumentet.

## 3. Primär målgrupp
Primär målgrupp är personer och organisationer som har äldre eller befintliga Publisher-dokument men behöver fortsätta arbeta professionellt i Adobe InDesign. Det inkluderar formgivare, kommunikatörer, byråer, trycksaksansvariga, marknadsavdelningar, offentliga verksamheter och administratörer som sitter med arkivmaterial eller återkommande mallar i Publisher och vill migrera dem utan manuellt ombrott.

## 4. Viktigaste användarflödet
Användaren öppnar webbappen, drar in eller väljer en Publisher-fil, startar konverteringen, väntar medan systemet analyserar dokumentet och återskapar dess struktur, och får därefter en tydlig resultatsida med:

1. status för konverteringen,
2. länk för att ladda ner den genererade InDesign-kompatibla filen,
3. en kort kvalitetsrapport som visar om något i dokumentet inte kunde mappas exakt.

Det absolut viktigaste är att den genererade filen öppnas i InDesign och ser ut som originalet så nära 1:1 som tekniskt möjligt, utan att användaren behöver bygga om layouten manuellt.

## 5. Centrala funktioner som appen bör ha
Appen bör minst innehålla följande funktioner:

- **Drag-and-drop-uppladdning av Publisher-fil** med tydlig filvalidering.
- **Serverbaserad konverteringspipeline** som läser Publisher-dokumentets struktur och genererar ett InDesign-kompatibelt utdataformat.
- **Fokus på layouttrohet framför snabbast möjliga MVP.** En lösning som bara rasteriserar sidor till bilder är inte godtagbar som kärnleverans.
- **Återskapande av dokumentstruktur**, inklusive sidor, sidstorlek, marginaler, spalter, textblock, bildramar, former, tabeller där möjligt, färgrutor, linjer och objektpositioner.
- **Återskapande av typografiska egenskaper**, inklusive typsnitt, grad, radavstånd, knipning/spärrning där möjligt, styckeavstånd, indrag, justering, versal/gemen, färg och annan grundläggande textformatering.
- **Återskapande av format som egna stilar** i måldokumentet, minst:
  - styckeformat,
  - teckenformat,
  - objektformat,
  - färgrutor,
  - eventuellt tabell-/cellformat om underlaget stöder det.
- **Mappning och deduplicering av stilar**, så att samma visuella definition inte skapas som dubbletter i InDesign-filen.
- **Font-hantering** med tydlig strategi för saknade typsnitt, inklusive rapportering och definierade fallback-regler.
- **Färghantering** för RGB/CMYK/spot där källdata tillåter detta.
- **Kvalitetsrapport efter konvertering** som anger:
  - vad som mappades exakt,
  - vad som approximativt återskapades,
  - vad som inte kunde stödjas,
  - vilka fonter eller resurser som saknades.
- **Nedladdningsbar resultatlänk** när jobbet är klart.
- **Jobbstatus** i gränssnittet, till exempel uppladdad, analyseras, konverteras, klar, misslyckades.
- **Felhantering** som är begriplig för användaren.
- **Testfiler och verifieringsfall** där samma Publisher-fil jämförs mot genererat resultat enligt mätbara kriterier.

Codex ska prioritera att bygga en pipeline som går att förbättra stegvis, men kärnan måste redan från början vara orienterad mot hög visuell och semantisk trohet.

## 6. Resultat eller värde appen ska ge användaren
Användaren ska få en faktisk tidsbesparing och slippa bygga om Publisher-dokument manuellt i InDesign. Värdet ligger i:

- **automation av ett annars mycket tidskrävande migreringsarbete**, 
- **bevarad layout och grafisk identitet**, 
- **redigerbar fortsättning i InDesign i stället för en platt bild- eller PDF-lösning**, 
- **bibehållna format/stilar som går att arbeta vidare med professionellt**, 
- **tydlig rapport om vad som blev exakt respektive vad som kräver manuell justering**.

Appen ska alltså ge både ett användbart resultatdokument och tillräcklig transparens för att användaren ska kunna lita på resultatet.

## 7. Kända krav eller begränsningar
Följande är redan bestämt eller ska behandlas som styrande krav:

- **Det viktigaste kravet är maximal likhet med originaldokumentet.** Layouttrohet är viktigare än att snabbt få fram en förenklad MVP.
- **Utdata ska vara en InDesign-kompatibel fil som användaren kan ladda ner via länk.**
- **Stilar och färger ska inte bara se lika ut visuellt, utan också definieras som egna återanvändbara format i dokumentet där det går.**
- **Appen ska vara en webapp.**
- **Användaren ska kunna släppa in filen direkt i gränssnittet.**
- **Codex ska inte anta att rasteriserade sidor eller endast PDF-export räcker.** Det kan möjligen användas som hjälpfunktion för preview eller jämförelse, men inte som slutmål.
- **Systemet får inte påstå att konverteringen är exakt när den inte är det.** Osäkerheter och avvikelser måste rapporteras.
- **Målformat i första hand bör vara IDML**, eftersom det är ett InDesign-kompatibelt och programmerbart format som lämpar sig för generering i servermiljö. Om native `.indd` senare krävs som slutligt binärt format bör detta hanteras som ett separat steg via Adobe InDesign/Adobe InDesign Server eller annan Adobe-stödd motor, inte som första antagande.
- **Codex ska utgå från att Publisher-formatet kan vara svårt eller ofullständigt dokumenterat**, och därför bygga lösningen modulärt med tydliga parser-, mappnings- och exportlager.
- **Codex ska tidigt utvärdera om fullständig direktkonvertering från `.pub` är realistisk**, eller om mellanrepresentation behövs. En sådan mellanrepresentation måste i så fall vara intern och bevara all möjlig semantik: sidor, ramar, text runs, stilar, färger, geometri, lager och resurser.
- **Det får gärna finnas köhantering eller bakgrundsjobb**, men bara om det behövs för robusthet; det är inte ett självändamål.
- **Ingen inloggning ska antas som krav i första versionen** om det inte behövs för den tekniska lösningen.
- **Ingen databas ska antas som produktkrav** om filhantering och jobbstatus kan lösas enklare i första fasen.

## 8. Känslig data, betalningar eller annan reglerad/högriskdomän
Domänen är inte i sig medicinsk, juridisk eller finansiell, men appen kan hantera dokument som är konfidentiella. Codex ska därför behandla filsäkerhet som viktig:

- uppladdade filer ska inte sparas längre än nödvändigt,
- temporära filer ska städas bort automatiskt,
- nedladdningslänkar ska vara tidsbegränsade,
- appen ska inte exponera andra användares filer,
- loggar ska inte innehålla full dokumenttext eller känsligt innehåll i onödan.

Ingen betalningslogik behöver antas i första versionen.

## 9. Visuell riktning om sådan finns
Visuell riktning kan vara enkel, sober och professionell. Gränssnittet ska signalera tillförlitlighet snarare än “startup-lekfullhet”. Tänk ren desktop-liknande arbetsyta med tydlig status, tydlig uppladdningsyta och tydlig resultatruta.

Önskad känsla:

- professionell,
- teknisk men lättbegriplig,
- få distraktioner,
- tydlig progression genom uppladdning, analys, konvertering och nedladdning.

Codex får själv föreslå visuell detaljstil, men UI ska vara sekundärt till konverteringskärnan. Ingen tid ska läggas på dekorativ design innan kärnflödet fungerar.

## 10. Definition av färdig app om du redan vet detta
Appen ska minst anses vara färdig när följande är sant:

- det finns en fungerande webapp med publik eller lokalt körbar URL,
- användaren kan dra in en Publisher-fil och starta ett jobb,
- appen producerar en nedladdningsbar InDesign-kompatibel fil,
- resultatfilen öppnas i Adobe InDesign,
- layouten i resultatfilen matchar originalet mycket nära i centrala testfall,
- styckeformat, teckenformat, objektformat och färgrutor återskapas som redigerbara format där källdatan medger det,
- appen visar en begriplig rapport över eventuella avvikelser,
- kärnflödet är testat end-to-end,
- det finns verifieringsfall med kända Publisher-exempel,
- det finns teknisk dokumentation som förklarar arkitektur, kända begränsningar och hur trohet mäts.

För att undvika att Codex optimerar för fel mål ska “klar” inte betyda att appen bara lyckas skapa någon sorts export. “Klar” betyder att appen i praktiken fungerar som ett seriöst migreringsverktyg från Publisher till InDesign, där hög layouttrohet och redigerbarhet är själva kärnleveransen.

---

## Extra styrning till Codex
När du planerar och bygger detta projekt ska du utgå från följande prioriteringsordning:

1. **Layouttrohet och redigerbarhet först.**
2. **Korrekt dokumentmodell och stilmodell före snyggt UI.**
3. **Ärlig rapportering av begränsningar före falsk precision.**
4. **Modulär arkitektur så att parser, intern representation, mappning och export kan förbättras separat.**
5. **Mätbar verifiering mot referensfiler.**

Du ska inte välja en genväg som förstör redigerbarheten i måldokumentet bara för att snabbt kunna visa ett visuellt resultat. Om en kompromiss krävs ska den dokumenteras tydligt och göras på ett sätt som lämnar öppet för senare förbättring.
