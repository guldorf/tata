// Zdrowie Taty – codzienny mail, gdy leki trzeba zamówić, i podsumowanie miesiąca (cukier i leki) w ostatni dzień miesiąca.
// Działa w Google Apps Script (script.google.com). Mail idzie na konto Google, na którym uruchomiono skrypt, i na drugi adres z Magazynu.
// Instalacja: wklej ten plik, wpisz HASLO poniżej, wybierz funkcję zainstaluj i kliknij Uruchom.

const HASLO = 'WPISZ-HASLO-DO-STRONY';
const KONFIG = {
  apiKey: 'AIzaSyCHvavuReCdBmhsqyeCDfxO1W_CDYH70Nc',
  projekt: 'zdrowie-taty-7412',
  mail: 'guldorf@tata.app',
  strona: 'https://guldorf.github.io/tata/#leki/magazyn',
  strefa: 'Europe/Warsaw',
  godzina: 8,          // o której sprawdzać (mniej więcej, Google daje okno 1 godziny)
  powtorzCoDni: 3,     // co ile dni przypominać o tym samym leku, dopóki stan nie zostanie uzupełniony
  progDomyslny: 10,
  godzinaRaportu: 21,  // podsumowanie miesiąca: ostatni dzień miesiąca, wieczorem (okno 1 godziny), żeby objąć wieczorne pomiary
  cukierNisko: 70,     // granice na wykresie cukru, mg/dL
  cukierWysoko: 180
};

function zainstaluj() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sprawdzLeki').timeBased().everyDays(1).atHour(KONFIG.godzina).inTimezone(KONFIG.strefa).create();
  zainstalujRaport();
  sprawdzLeki();
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'Zdrowie Taty: powiadomienia o lekach włączone',
    body: 'Skrypt działa. Leki będą sprawdzane codziennie około godziny ' + KONFIG.godzina + ':00, '
      + 'a podsumowanie miesiąca przyjdzie w ostatni dzień miesiąca około ' + KONFIG.godzinaRaportu + ':00.\n\n' + KONFIG.strona
  });
}

// Włącza samo podsumowanie miesiąca, bez ruszania codziennego sprawdzania leków.
function zainstalujRaport() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'raportMiesieczny').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('raportMiesieczny').timeBased().everyDays(1).atHour(KONFIG.godzinaRaportu).inTimezone(KONFIG.strefa).create();
}

function sprawdzLeki() {
  const token = zaloguj_();
  const leki = (bazaGet_('leki', token).documents || []).map(odczytajDokument_);
  const alarm = odczytajDokument_(bazaGet_('ustawienia/alarm', token, true) || {});
  const wynik = wybierzLeki_(leki, alarm, new Date());
  if (wynik.doWyslania) {
    MailApp.sendEmail(Object.assign(budujMail_(wynik), { to: adresaci_(alarm) }));
  }
  bazaZapiszAlarm_(wynik.wyslano, token);
}

// Wysyła mail z obecnym stanem leków od razu, nawet gdy nic nie trzeba zamawiać. Do podejrzenia, jak wygląda.
function wyslijProbny() {
  const token = zaloguj_();
  const leki = (bazaGet_('leki', token).documents || []).map(odczytajDokument_);
  const alarm = odczytajDokument_(bazaGet_('ustawienia/alarm', token, true) || {});
  MailApp.sendEmail(Object.assign(budujMail_(wybierzLeki_(leki, alarm, new Date())), { to: adresaci_(alarm) }));
}

// Właściciel skryptu plus drugi adres wpisany na stronie w Magazynie (jeśli jest poprawny).
function adresaci_(alarm) {
  const drugi = String(alarm.drugiMail || '').trim();
  const adresy = [Session.getEffectiveUser().getEmail()];
  if (/^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(drugi)) adresy.push(drugi);
  return adresy.join(',');
}

// Te same zasady co na stronie (stanLeku): stan to tabletki rano, przed dzisiejszą dawką.
function wybierzLeki_(leki, alarm, teraz) {
  const dzis = dzienTekst_(teraz);
  const prog = alarm.prog > 0 ? alarm.prog : KONFIG.progDomyslny;
  const poprzednio = alarm.wyslano || {};
  const wyslano = {};
  const alarmowe = [];
  const wszystkie = [];
  const bezStanu = [];
  let doWyslania = false;
  leki.forEach(l => {
    if (!(l.naDzien > 0)) return;
    if (l.stan === null || l.stan === undefined || !l.stanData) { bezStanu.push(l.nazwa); return; }
    const minelo = Math.max(0, dniMiedzy_(dzienTekst_(l.stanData), dzis));
    const zostalo = Math.max(0, l.stan - l.naDzien * minelo);
    const dni = Math.floor(zostalo / l.naDzien);
    const lek = { nazwa: l.nazwa, zostalo: zostalo, dni: dni, koniec: dodajDni_(dzis, dni - 1) };
    wszystkie.push(lek);
    if (dni > prog) return;
    alarmowe.push(lek);
    const ostatni = poprzednio[l.id];
    if (!ostatni || dniMiedzy_(ostatni, dzis) >= KONFIG.powtorzCoDni) doWyslania = true;
    wyslano[l.id] = ostatni;
  });
  // mail wymienia wszystkie leki do zamówienia, więc liczy się jako przypomnienie o każdym z nich
  if (doWyslania) Object.keys(wyslano).forEach(id => { wyslano[id] = dzis; });
  alarmowe.sort((a, b) => a.dni - b.dni);
  wszystkie.sort((a, b) => a.dni - b.dni);
  return { alarmowe: alarmowe, wszystkie: wszystkie, bezStanu: bezStanu, prog: prog, doWyslania: doWyslania, wyslano: wyslano };
}

const dniTekst_ = n => (n === 1 ? '1 dzień' : n + ' dni');
const opisLeku_ = a => {
  const kiedy = a.dni === 0 ? 'już brak' : `zostało na ${dniTekst_(a.dni)}, do ${dataPl_(a.koniec)}`;
  return `${a.nazwa}: ${kiedy}` + (a.zostalo > 0 ? ` (ok. ${String(Math.round(a.zostalo * 100) / 100).replace('.', ',')} tabl.)` : '');
};
const esc_ = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Treść maila: co zamówić, co skończy się niedługo (do 2 x próg) i słupki z zapasem wszystkich leków.
// Słupek zapasu jednego leku (wiersze tabeli). Dłuższe zapasy niż skala mają pełny słupek, a dokładną liczbę dni w opisie.
const skalaSlupkow_ = prog => Math.max(30, 3 * prog);
function slupekHtml_(a, prog, dopisek) {
  const stany = { zamow: ['#d03b3b', 'zamów'], wkrotce: ['#fab219', 'wkrótce'], ok: ['#67B437', 'jest zapas'] };
  const s = a.dni <= prog ? stany.zamow : a.dni <= 2 * prog ? stany.wkrotce : stany.ok;
  const szer = Math.min(100, Math.round(a.dni / skalaSlupkow_(prog) * 100));
  return `<tr><td style="padding:7px 0 0;font-size:15px;color:#111"><b>${esc_(a.nazwa)}</b></td>
      <td align="right" style="padding:7px 0 0;font-size:15px;color:#4a4f4c;white-space:nowrap">${a.dni === 0 ? 'brak' : dniTekst_(a.dni)} · ${s[1]}</td></tr>
      <tr><td colspan="2" style="padding:3px 0 0"><div style="background:#eef1ef;border-radius:4px;height:14px;line-height:14px;font-size:0">
      ${szer > 0 ? `<div style="background:${s[0]};border-radius:0 4px 4px 0;height:14px;width:${szer}%"></div>` : ''}</div></td></tr>`
    + (dopisek ? `<tr><td colspan="2" style="padding:2px 0 0;font-size:13px;color:#4a4f4c">${dopisek}</td></tr>` : '');
}

function budujMail_(w) {
  const prog = w.prog;
  const wkrotce = w.wszystkie.filter(a => a.dni > prog && a.dni <= 2 * prog);
  const skala = skalaSlupkow_(prog);

  const sekcja = t => `<h2 style="font-size:17px;margin:22px 0 8px;color:#111">${t}</h2>`;
  const lista = a => `<p style="margin:4px 0;font-size:16px;color:#111"><b>${esc_(a.nazwa)}</b>: ${esc_(opisLeku_(a).slice(a.nazwa.length + 2))}</p>`;
  const slupek = a => slupekHtml_(a, prog);

  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;color:#111">
    ${w.alarmowe.length ? `<div style="background:#d03b3b;color:#fff;border-radius:12px;padding:12px 14px;font-size:20px;font-weight:700">Zamów leki: starczą na ${dniTekst_(prog)} lub mniej</div>${w.alarmowe.map(lista).join('')}`
      : `<div style="background:#67B437;color:#2B2A29;border-radius:12px;padding:12px 14px;font-size:20px;font-weight:700">Nic nie trzeba teraz zamawiać</div>`}
    ${wkrotce.length ? sekcja('Mogą się skończyć niedługo') + wkrotce.map(lista).join('') : ''}
    ${sekcja('Na ile dni starczą wszystkie leki')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${w.wszystkie.map(slupek).join('')}</table>
    <p style="font-size:13px;color:#4a4f4c;margin:10px 0 0">Zamów: do ${dniTekst_(prog)}. Wkrótce: do ${dniTekst_(2 * prog)}. Pełny słupek: ${dniTekst_(skala)} lub więcej.</p>
    ${w.bezStanu.length ? `<p style="font-size:15px;margin:14px 0 0"><b>Bez wpisanego stanu:</b> ${w.bezStanu.map(esc_).join(', ')}</p>` : ''}
    <p style="margin:20px 0 0"><a href="${KONFIG.strona}" style="display:inline-block;background:#67B437;color:#2B2A29;font-weight:700;text-decoration:none;border-radius:10px;padding:12px 18px">Otwórz magazyn</a></p>
    <p style="font-size:13px;color:#4a4f4c;margin:10px 0 0">Po zakupie uzupełnij stan w magazynie.</p></div>`;

  const body = [
    w.alarmowe.length ? 'Leki taty, które trzeba zamówić:\n' + w.alarmowe.map(opisLeku_).join('\n') : 'Nic nie trzeba teraz zamawiać.',
    wkrotce.length ? 'Mogą się skończyć niedługo:\n' + wkrotce.map(opisLeku_).join('\n') : '',
    'Na ile dni starczą wszystkie leki:\n' + w.wszystkie.map(a => `${a.nazwa}: ${a.dni === 0 ? 'brak' : dniTekst_(a.dni)}`).join('\n'),
    w.bezStanu.length ? 'Bez wpisanego stanu: ' + w.bezStanu.join(', ') : '',
    'Po zakupie uzupełnij stan w magazynie:\n' + KONFIG.strona
  ].filter(Boolean).join('\n\n');

  return {
    to: Session.getEffectiveUser().getEmail(),
    subject: w.alarmowe.length ? 'Zamów leki: ' + w.alarmowe.map(a => a.nazwa).join(', ') : 'Zdrowie Taty: stan leków',
    body: body,
    htmlBody: html
  };
}

// ---------- podsumowanie miesiąca: cukier i leki ----------
const MIESIACE_ = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MIESIACA_ = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const MIESIACU_ = ['styczniu', 'lutym', 'marcu', 'kwietniu', 'maju', 'czerwcu', 'lipcu', 'sierpniu', 'wrześniu', 'październiku', 'listopadzie', 'grudniu'];
const liczbaPl_ = x => String(Math.round(x * 100) / 100).replace('.', ',');

// Wyzwalacz uruchamia tę funkcję codziennie wieczorem. Mail idzie tylko w ostatni dzień miesiąca, za cały ten miesiąc.
function raportMiesieczny() {
  const dzis = dzienTekst_(new Date());
  const jutro = dodajDni_(dzis, 1);
  if (jutro.slice(8) !== '01') return;
  wyslijRaport_(dzis.slice(0, 7) + '-01', jutro, false);
}

// Podsumowanie bieżącego miesiąca do dziś, tylko na adres właściciela skryptu. Do podejrzenia, jak wygląda.
function wyslijRaportProbny() {
  const dzis = dzienTekst_(new Date());
  wyslijRaport_(dzis.slice(0, 7) + '-01', dodajDni_(dzis, 1), true);
}

// od: pierwszy dzień miesiąca, doDnia: dzień po ostatnim dniu raportu (oba rrrr-mm-dd)
function wyslijRaport_(od, doDnia, probny) {
  const token = zaloguj_();
  const cukier = bazaZakres_('cukier', poprzedniMiesiac_(od), doDnia, token); // poprzedni miesiąc do porównania średniej
  const leki = (bazaGet_('leki', token).documents || []).map(odczytajDokument_);
  const alarm = odczytajDokument_(bazaGet_('ustawienia/alarm', token, true) || {});
  const mail = budujRaport_(policzRaport_(od, doDnia, cukier, leki, alarm, probny));
  mail.to = probny ? Session.getEffectiveUser().getEmail() : adresaci_(alarm);
  MailApp.sendEmail(mail);
}

function poprzedniMiesiac_(od) {
  const p = od.split('-').map(Number);
  return p[1] === 1 ? `${p[0] - 1}-12-01` : `${p[0]}-${String(p[1] - 1).padStart(2, '0')}-01`;
}

function policzRaport_(od, doDnia, cukier, leki, alarm, probny) {
  const pomiary = cukier.filter(w => w.kiedy instanceof Date && isFinite(Number(w.wartosc)) && w.wartosc !== null)
    .map(w => ({ kiedy: w.kiedy, dzien: dzienTekst_(w.kiedy), wartosc: Number(w.wartosc) }))
    .sort((a, b) => a.kiedy - b.kiedy);
  const teraz = pomiary.filter(w => w.dzien >= od && w.dzien < doDnia);
  const wczesniej = pomiary.filter(w => w.dzien < od);
  const srednia = a => (a.length ? a.reduce((s, w) => s + w.wartosc, 0) / a.length : null);
  const v = teraz.map(w => w.wartosc);
  const dni = dniMiedzy_(od, doDnia);

  // leki: stan rano w dniu doDnia, czyli po ostatniej dawce raportowanego okresu (te same zasady co sprawdzLeki)
  const lekiR = leki.filter(l => l.naDzien > 0).map(l => {
    const lek = { nazwa: l.nazwa, naDzien: l.naDzien, wOkresie: l.naDzien * dni, znany: !(l.stan === null || l.stan === undefined || !l.stanData) };
    if (lek.znany) {
      lek.zostalo = Math.max(0, l.stan - l.naDzien * Math.max(0, dniMiedzy_(dzienTekst_(l.stanData), doDnia)));
      lek.dni = Math.floor(lek.zostalo / l.naDzien);
    }
    return lek;
  });

  return {
    od: od, doDnia: doDnia, dni: dni, probny: !!probny, miesiac: Number(od.slice(5, 7)) - 1, rok: od.slice(0, 4),
    prog: alarm.prog > 0 ? alarm.prog : KONFIG.progDomyslny,
    cukier: {
      wpisy: teraz, liczba: v.length, dniZPomiarem: new Set(teraz.map(w => w.dzien)).size,
      srednia: srednia(teraz), min: v.length ? Math.min.apply(null, v) : null, max: v.length ? Math.max.apply(null, v) : null,
      nisko: v.filter(x => x < KONFIG.cukierNisko).length,
      wysoko: v.filter(x => x > KONFIG.cukierWysoko).length,
      sredniaWczesniej: srednia(wczesniej)
    },
    leki: lekiR.filter(l => l.znany).sort((a, b) => a.dni - b.dni),
    bezStanu: lekiR.filter(l => !l.znany).map(l => l.nazwa)
  };
}

// Wykres liniowy wszystkich pomiarów z liniami granic, jako obrazek PNG do maila.
function wykresCukru_(r) {
  const c = r.cukier, t = Charts.newDataTable()
    .addColumn(Charts.ColumnType.DATE, 'Dzień')
    .addColumn(Charts.ColumnType.NUMBER, 'Cukier (mg/dL)')
    .addColumn(Charts.ColumnType.NUMBER, 'Granica ' + KONFIG.cukierWysoko)
    .addColumn(Charts.ColumnType.NUMBER, 'Granica ' + KONFIG.cukierNisko);
  c.wpisy.forEach(w => t.addRow([w.kiedy, w.wartosc, KONFIG.cukierWysoko, KONFIG.cukierNisko]));
  return Charts.newLineChart()
    .setDataTable(t.build())
    .setDimensions(680, 320)
    .setColors(['#2f7d1f', '#fab219', '#d03b3b'])
    .setLegendPosition(Charts.Position.BOTTOM)
    .setRange(Math.min(40, c.min - 10), Math.max(260, c.max + 20))
    .setPointStyle(Charts.PointStyle.MEDIUM)
    .setOption('series', { 1: { pointSize: 0, lineWidth: 1 }, 2: { pointSize: 0, lineWidth: 1 } })
    .setOption('hAxis', { format: 'd.MM' })
    .setOption('chartArea', { left: 50, top: 20, width: '88%', height: '70%' })
    .build().getAs('image/png').setName('cukier.png');
}

// Zapasowy wykres z tabeli HTML (średnia dzienna), gdyby obrazek się nie wygenerował.
function wykresCukruHtml_(r) {
  const kolor = x => (x < KONFIG.cukierNisko ? '#d03b3b' : x > KONFIG.cukierWysoko ? '#fab219' : '#67B437');
  const max = Math.max(KONFIG.cukierWysoko + 40, r.cukier.max), wys = 120;
  let kolumny = '', podpisy = '';
  for (let d = r.od; d < r.doDnia; d = dodajDni_(d, 1)) {
    const a = r.cukier.wpisy.filter(w => w.dzien === d).map(w => w.wartosc);
    const sr = a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
    kolumny += `<td valign="bottom" style="padding:0 1px;height:${wys}px">${sr === null ? '' : `<div title="${Math.round(sr)}" style="background:${kolor(sr)};height:${Math.max(2, Math.round(sr / max * wys))}px;border-radius:2px 2px 0 0"></div>`}</td>`;
    const n = Number(d.slice(8));
    podpisy += `<td align="center" style="font-size:10px;color:#4a4f4c">${n === 1 || n % 5 === 0 ? n : ''}</td>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed"><tr>${kolumny}</tr><tr>${podpisy}</tr></table>
    <p style="font-size:13px;color:#4a4f4c;margin:6px 0 0">Średnia z każdego dnia. Zielony: ${KONFIG.cukierNisko}–${KONFIG.cukierWysoko}, żółty: powyżej ${KONFIG.cukierWysoko}, czerwony: poniżej ${KONFIG.cukierNisko} mg/dL.</p>`;
}

function budujRaport_(r) {
  const c = r.cukier, m = r.miesiac;
  const ostatni = Number(dodajDni_(r.doDnia, -1).slice(8));
  const okres = r.probny ? `1–${ostatni} ${MIESIACA_[m]} ${r.rok} (próbny, do dziś)` : `${MIESIACE_[m]} ${r.rok}`;
  const poprz = MIESIACU_[(m + 11) % 12];
  const mg = x => Math.round(x) + ' mg/dL';
  const sekcja = t => `<h2 style="font-size:19px;margin:26px 0 10px;color:#111">${t}</h2>`;
  const kafel = (t, w) => `<td width="25%" style="padding:3px"><div style="background:#eef1ef;border-radius:10px;padding:10px 6px;text-align:center">
    <div style="font-size:13px;color:#4a4f4c">${t}</div><div style="font-size:20px;font-weight:700;color:#111;white-space:nowrap">${w}</div></div></td>`;

  let porownanie = '';
  if (c.liczba && c.sredniaWczesniej !== null) {
    const roznica = Math.round(c.srednia - c.sredniaWczesniej);
    porownanie = roznica === 0 ? `Średnia taka sama jak w ${poprz}.`
      : `Średnia ${roznica > 0 ? 'wyższa' : 'niższa'} o ${Math.abs(roznica)} mg/dL niż w ${poprz} (${mg(c.sredniaWczesniej)}).`;
  }

  let wykres = null, inlineImages;
  if (c.liczba) {
    try { wykres = wykresCukru_(r); inlineImages = { cukier: wykres }; } catch (e) { console.warn('Wykres cukru jako obrazek się nie udał: ' + e); }
  }

  const cukierHtml = !c.liczba ? '<p style="font-size:16px">Brak pomiarów cukru w tym okresie.</p>' : `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
      ${kafel('Średnio', Math.round(c.srednia))}${kafel('Najniżej', Math.round(c.min))}${kafel('Najwyżej', Math.round(c.max))}${kafel('Pomiarów', c.liczba)}
    </tr></table>
    <p style="font-size:13px;color:#4a4f4c;margin:6px 0 12px">Wartości w mg/dL. Pomiary w ${c.dniZPomiarem} z ${r.dni} dni.</p>
    ${wykres ? '<img src="cid:cukier" alt="Wykres cukru" width="520" style="width:100%;max-width:520px;height:auto;display:block;border:0">' : wykresCukruHtml_(r)}
    <p style="font-size:15px;margin:12px 0 0">Poniżej ${KONFIG.cukierNisko}: <b>${c.nisko}</b> · ${KONFIG.cukierNisko}–${KONFIG.cukierWysoko}: <b>${c.liczba - c.nisko - c.wysoko}</b> · powyżej ${KONFIG.cukierWysoko}: <b>${c.wysoko}</b></p>
    ${porownanie ? `<p style="font-size:15px;margin:6px 0 0">${porownanie}</p>` : ''}`;

  const dopisek = l => `${r.probny ? 'Od początku miesiąca' : 'W miesiącu'} ${liczbaPl_(l.wOkresie)} tabl. (${liczbaPl_(l.naDzien)} dziennie), zostało ok. ${liczbaPl_(l.zostalo)} tabl.`;
  const lekiHtml = (r.leki.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${r.leki.map(l => slupekHtml_(l, r.prog, dopisek(l))).join('')}</table>
       <p style="font-size:13px;color:#4a4f4c;margin:10px 0 0">Słupek: na ile dni starczy lek. Zamów: do ${dniTekst_(r.prog)}. Pełny słupek: ${dniTekst_(skalaSlupkow_(r.prog))} lub więcej. Liczba tabletek według dawkowania.</p>`
    : '<p style="font-size:16px">Brak leków z wpisanym stanem.</p>')
    + (r.bezStanu.length ? `<p style="font-size:15px;margin:12px 0 0"><b>Bez wpisanego stanu:</b> ${r.bezStanu.map(esc_).join(', ')}</p>` : '');

  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;color:#111">
    <div style="background:#67B437;color:#2B2A29;border-radius:12px;padding:12px 14px"><div style="font-size:14px">Zdrowie Taty · podsumowanie</div>
      <div style="font-size:22px;font-weight:700">${okres}</div></div>
    ${sekcja('Cukier')}${cukierHtml}
    ${sekcja(r.probny ? 'Leki: stan na jutro rano' : 'Leki: stan na początek ' + MIESIACA_[(m + 1) % 12])}${lekiHtml}
    <p style="margin:22px 0 0"><a href="${KONFIG.strona.split('#')[0]}" style="display:inline-block;background:#67B437;color:#2B2A29;font-weight:700;text-decoration:none;border-radius:10px;padding:12px 18px">Otwórz Zdrowie Taty</a></p></div>`;

  const body = [
    'Zdrowie Taty, podsumowanie: ' + okres,
    c.liczba ? `Cukier: średnio ${mg(c.srednia)}, najniżej ${mg(c.min)}, najwyżej ${mg(c.max)}, pomiarów ${c.liczba} (w ${c.dniZPomiarem} z ${r.dni} dni).\n`
      + `Poniżej ${KONFIG.cukierNisko}: ${c.nisko}, powyżej ${KONFIG.cukierWysoko}: ${c.wysoko}.` + (porownanie ? '\n' + porownanie : '')
      : 'Cukier: brak pomiarów.',
    'Leki (na ile dni starczą):\n' + r.leki.map(l => `${l.nazwa}: ${l.dni === 0 ? 'brak' : dniTekst_(l.dni)}. ${dopisek(l)}`).join('\n'),
    r.bezStanu.length ? 'Bez wpisanego stanu: ' + r.bezStanu.join(', ') : '',
    KONFIG.strona.split('#')[0]
  ].filter(Boolean).join('\n\n');

  const mail = { subject: 'Zdrowie Taty: podsumowanie, ' + okres, body: body, htmlBody: html };
  if (inlineImages) mail.inlineImages = inlineImages;
  return mail;
}

// Wpisy kolekcji z polem kiedy w przedziale [od, doDnia), dni liczone w strefie Polski.
function bazaZakres_(kolekcja, od, doDnia, token) {
  const ts = t => ({ timestampValue: Utilities.parseDate(t, KONFIG.strefa, 'yyyy-MM-dd').toISOString() });
  const filtr = (op, t) => ({ fieldFilter: { field: { fieldPath: 'kiedy' }, op: op, value: ts(t) } });
  const r = UrlFetchApp.fetch(`https://firestore.googleapis.com/v1/projects/${KONFIG.projekt}/databases/(default)/documents:runQuery`, {
    method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true,
    payload: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: kolekcja }],
      where: { compositeFilter: { op: 'AND', filters: [filtr('GREATER_THAN_OR_EQUAL', od), filtr('LESS_THAN', doDnia)] } },
      orderBy: [{ field: { fieldPath: 'kiedy' }, direction: 'ASCENDING' }]
    } })
  });
  if (r.getResponseCode() !== 200) throw new Error('Baza: ' + r.getContentText());
  return JSON.parse(r.getContentText()).filter(x => x.document).map(x => odczytajDokument_(x.document));
}

// ---------- daty jako tekst rrrr-mm-dd w strefie Polski ----------
function dzienTekst_(d) { return Utilities.formatDate(d, KONFIG.strefa, 'yyyy-MM-dd'); }
function dzienUtc_(t) { const p = t.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
function dniMiedzy_(a, b) { return Math.round((dzienUtc_(b) - dzienUtc_(a)) / 864e5); }
function dodajDni_(t, n) { return new Date(dzienUtc_(t) + n * 864e5).toISOString().slice(0, 10); }
function dataPl_(t) { return t.split('-').reverse().join('.'); }

// ---------- Firebase przez REST ----------
function zaloguj_() {
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + KONFIG.apiKey, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ email: KONFIG.mail, password: HASLO, returnSecureToken: true })
  });
  return JSON.parse(r.getContentText()).idToken;
}
function adresBazy_(sciezka) {
  return `https://firestore.googleapis.com/v1/projects/${KONFIG.projekt}/databases/(default)/documents/${sciezka}`;
}
function bazaGet_(sciezka, token, mozeNieByc) {
  const r = UrlFetchApp.fetch(adresBazy_(sciezka) + (sciezka === 'leki' ? '?pageSize=300' : ''), {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
  });
  if (mozeNieByc && r.getResponseCode() === 404) return null;
  if (r.getResponseCode() !== 200) throw new Error('Baza: ' + r.getContentText());
  return JSON.parse(r.getContentText());
}
function bazaZapiszAlarm_(wyslano, token) {
  const pola = {};
  Object.keys(wyslano).forEach(id => { pola[id] = { stringValue: wyslano[id] }; });
  const r = UrlFetchApp.fetch(adresBazy_('ustawienia/alarm') + '?updateMask.fieldPaths=sprawdzono&updateMask.fieldPaths=wyslano', {
    method: 'patch', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true,
    payload: JSON.stringify({ fields: { sprawdzono: { timestampValue: new Date().toISOString() }, wyslano: { mapValue: { fields: pola } } } })
  });
  if (r.getResponseCode() !== 200) throw new Error('Baza: ' + r.getContentText());
}
function odczytajWartosc_(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('mapValue' in v) return odczytajPola_(v.mapValue.fields || {});
  return null;
}
function odczytajPola_(pola) {
  const o = {};
  Object.keys(pola).forEach(k => { o[k] = odczytajWartosc_(pola[k]); });
  return o;
}
function odczytajDokument_(d) {
  const o = odczytajPola_(d.fields || {});
  if (d.name) o.id = d.name.split('/').pop();
  return o;
}
