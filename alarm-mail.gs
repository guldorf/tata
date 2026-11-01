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
  progDomyslny: 10
};

function zainstaluj() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sprawdzLeki').timeBased().everyDays(1).atHour(KONFIG.godzina).inTimezone(KONFIG.strefa).create();
  sprawdzLeki();
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'Zdrowie Taty: powiadomienia o lekach włączone',
    body: 'Skrypt działa. Leki będą sprawdzane codziennie około godziny ' + KONFIG.godzina + ':00.\n\n' + KONFIG.strona
  });
}

function sprawdzLeki() {
  const token = zaloguj_();
  const leki = (bazaGet_('leki', token).documents || []).map(odczytajDokument_);
  const alarm = odczytajDokument_(bazaGet_('ustawienia/alarm', token, true) || {});
  const wynik = wybierzLeki_(leki, alarm, new Date());
  if (wynik.doWyslania) {
    MailApp.sendEmail(budujMail_(wynik));
  }
  bazaZapiszAlarm_(wynik.wyslano, token);
}

// Wysyła mail z obecnym stanem leków od razu, nawet gdy nic nie trzeba zamawiać. Do podejrzenia, jak wygląda.
function wyslijProbny() {
  const token = zaloguj_();
  const leki = (bazaGet_('leki', token).documents || []).map(odczytajDokument_);
  const alarm = odczytajDokument_(bazaGet_('ustawienia/alarm', token, true) || {});
  MailApp.sendEmail(budujMail_(wybierzLeki_(leki, alarm, new Date())));
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
function budujMail_(w) {
  const prog = w.prog;
  const wkrotce = w.wszystkie.filter(a => a.dni > prog && a.dni <= 2 * prog);
  const stany = { zamow: ['#d03b3b', 'zamów'], wkrotce: ['#fab219', 'wkrótce'], ok: ['#67B437', 'jest zapas'] };
  const stan = a => (a.dni <= prog ? stany.zamow : a.dni <= 2 * prog ? stany.wkrotce : stany.ok);
  const skala = Math.max(30, 3 * prog); // dłuższe zapasy mają pełny słupek, a dokładną liczbę dni w opisie

  const sekcja = t => `<h2 style="font-size:17px;margin:22px 0 8px;color:#111">${t}</h2>`;
  const lista = a => `<p style="margin:4px 0;font-size:16px;color:#111"><b>${esc_(a.nazwa)}</b>: ${esc_(opisLeku_(a).slice(a.nazwa.length + 2))}</p>`;
  const slupek = a => {
    const s = stan(a), szer = Math.min(100, Math.round(a.dni / skala * 100));
    return `<tr><td style="padding:7px 0 0;font-size:15px;color:#111"><b>${esc_(a.nazwa)}</b></td>
      <td align="right" style="padding:7px 0 0;font-size:15px;color:#4a4f4c;white-space:nowrap">${a.dni === 0 ? 'brak' : dniTekst_(a.dni)} · ${s[1]}</td></tr>
      <tr><td colspan="2" style="padding:3px 0 0"><div style="background:#eef1ef;border-radius:4px;height:14px;line-height:14px;font-size:0">
      ${szer > 0 ? `<div style="background:${s[0]};border-radius:0 4px 4px 0;height:14px;width:${szer}%"></div>` : ''}</div></td></tr>`;
  };

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
