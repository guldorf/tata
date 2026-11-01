// Zdrowie Taty – codzienny mail, gdy leki trzeba zamówić. Działa w Google Apps Script (script.google.com).
// Mail idzie na konto Google, na którym uruchomiono skrypt.
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
  progDomyslny: 14
};

function zainstaluj() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sprawdzLeki').timeBased().everyDays(1).atHour(KONFIG.godzina).inTimezone(KONFIG.strefa).create();
  sprawdzLeki();
}

function sprawdzLeki() {
  const token = zaloguj_();
  const leki = (bazaGet_('leki', token).documents || []).map(odczytajDokument_);
  const alarm = odczytajDokument_(bazaGet_('ustawienia/alarm', token, true) || {});
  const wynik = wybierzLeki_(leki, alarm, new Date());
  if (wynik.doWyslania) {
    wyslijMail_(wynik.alarmowe);
  }
  bazaZapiszAlarm_(wynik.wyslano, token);
}

// Te same zasady co na stronie (stanLeku): stan to tabletki rano, przed dzisiejszą dawką.
function wybierzLeki_(leki, alarm, teraz) {
  const dzis = dzienTekst_(teraz);
  const prog = alarm.prog > 0 ? alarm.prog : KONFIG.progDomyslny;
  const poprzednio = alarm.wyslano || {};
  const wyslano = {};
  const alarmowe = [];
  let doWyslania = false;
  leki.forEach(l => {
    if (l.stan === null || l.stan === undefined || !l.stanData || !(l.naDzien > 0)) return;
    const minelo = Math.max(0, dniMiedzy_(dzienTekst_(l.stanData), dzis));
    const zostalo = Math.max(0, l.stan - l.naDzien * minelo);
    const dni = Math.floor(zostalo / l.naDzien);
    if (dni > prog) return;
    alarmowe.push({ nazwa: l.nazwa, zostalo: zostalo, dni: dni, koniec: dodajDni_(dzis, dni - 1) });
    const ostatni = poprzednio[l.id];
    if (!ostatni || dniMiedzy_(ostatni, dzis) >= KONFIG.powtorzCoDni) doWyslania = true;
    wyslano[l.id] = ostatni;
  });
  // mail wymienia wszystkie leki do zamówienia, więc liczy się jako przypomnienie o każdym z nich
  if (doWyslania) Object.keys(wyslano).forEach(id => { wyslano[id] = dzis; });
  alarmowe.sort((a, b) => a.dni - b.dni);
  return { alarmowe: alarmowe, doWyslania: doWyslania, wyslano: wyslano };
}

function wyslijMail_(alarmowe) {
  const wiersze = alarmowe.map(a => {
    const kiedy = a.dni === 0 ? 'już brak' : `zostało na ${a.dni === 1 ? '1 dzień' : a.dni + ' dni'}, do ${dataPl_(a.koniec)}`;
    return `${a.nazwa}: ${kiedy} (ok. ${String(Math.round(a.zostalo * 100) / 100).replace('.', ',')} tabl.)`;
  });
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'Zamów leki: ' + alarmowe.map(a => a.nazwa).join(', '),
    body: 'Leki taty, które trzeba zamówić:\n\n' + wiersze.join('\n') + '\n\nPo zakupie uzupełnij stan w magazynie:\n' + KONFIG.strona
  });
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
